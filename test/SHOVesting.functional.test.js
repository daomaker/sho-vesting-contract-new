const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

describe("SHO Vesting Smart Contract", function() {
    let owner, user1, user2, user3, contract, vestingToken, vestingTokenDecimals, settings;
    
    const parseUnits = (value, decimals = vestingTokenDecimals) => {
        return ethers.utils.parseUnits(value.toString(), decimals);
    }

    const defaultSettings = {
        firstUnlockPercentage: 200,
        linearVestingOffset: 90 * 86400,
        linearVestingPeriod: 86400,
        linearUnlocksCount: 200,
        batch1Percentage: 300, 
        batch2Delay: 90 * 86400,
        lockedClaimableTokensOffset: 90 * 86400,
        burnRate: 800,
        vestingTokenDecimals: 18
    }

    const getPrecisionLoss = () => {
        return (10 ** vestingTokenDecimals).toString();
    }

    const init = async(_settings = {}) => {
        [owner, feeCollector1, feeCollector2, burnWallet, user1, user2, user3] = await ethers.getSigners();

        settings = {
            startTime: _settings.startTime ?? Number(await time.latest()),
            firstUnlockPercentage: _settings.firstUnlockPercentage ?? defaultSettings.firstUnlockPercentage,
            linearVestingOffset: _settings.linearVestingOffset ?? defaultSettings.linearVestingOffset,
            linearVestingPeriod: _settings.linearVestingPeriod ?? defaultSettings.linearVestingPeriod,
            linearUnlocksCount: _settings.linearUnlocksCount ?? defaultSettings.linearUnlocksCount,
            batch1Percentage: _settings.batch1Percentage ?? defaultSettings.batch1Percentage,
            batch2Delay: _settings.batch2Delay ?? defaultSettings.batch2Delay,
            lockedClaimableTokensOffset: _settings.lockedClaimableTokensOffset ?? defaultSettings.lockedClaimableTokensOffset,
            burnRate: _settings.burnRate ?? defaultSettings.burnRate,
            vestingTokenDecimals: _settings.vestingTokenDecimals ?? defaultSettings.vestingTokenDecimals,
        };

        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        vestingToken = await ERC20Mock.deploy("MOCK1", "MOCK1", owner.address, parseUnits(100000000), settings.vestingTokenDecimals);
        vestingTokenDecimals = settings.vestingTokenDecimals;

        const Contract = await ethers.getContractFactory("SHOVestingMock");
        contract = await Contract.deploy(
            vestingToken.address,
            settings.startTime,
            settings.firstUnlockPercentage,
            settings.linearVestingOffset,
            settings.linearVestingPeriod,
            settings.linearUnlocksCount,
            settings.batch1Percentage,
            settings.batch2Delay,
            settings.lockedClaimableTokensOffset,
            settings.burnRate,
            [feeCollector1.address, feeCollector2.address, burnWallet.address]
        );

        await vestingToken.transfer(contract.address, parseUnits(100000000));
    }

    const setUserStats = async(user, stats = {}) => {
        await contract.setUserStats(
            user.address,
            stats.hasBatch2Delay ?? false,
            stats.eliminatedAt ?? 0,
            stats.totalTokens ?? parseUnits(5000),
            stats.totalFee ?? parseUnits(0),
            stats.totalBurned ?? parseUnits(0),
            stats.totalClaimed ?? parseUnits(0),
            stats.totalClaimed1 ?? 0,
            stats.totalClaimed2 ?? 0,
            stats.totalClaimedFromLocked ?? 0
        );
    };

    const collectFees = async(user, expectedFees) => {
        await contract.collectFees([user.address]);
        expect(await vestingToken.balanceOf(feeCollector1.address)).to.closeTo(parseUnits(expectedFees), getPrecisionLoss());
    }

    const verifyReturnValues = async(
        user, 
        vestingSchedule, 
        locked,
        unlocked,
        unlocked1,
        unlocked2
    ) => {
        expect(await contract.getVestingSchedule(user.address, false)).to.closeTo(parseUnits(vestingSchedule), getPrecisionLoss());
        expect(await contract.getLocked(user.address)).to.closeTo(parseUnits(locked), getPrecisionLoss());
        expect(await contract.getUnlocked(user.address)).to.closeTo(parseUnits(unlocked), getPrecisionLoss());
        expect(await contract.getUnlocked1(user.address)).to.closeTo(parseUnits(unlocked1), getPrecisionLoss());
        expect(await contract.getUnlocked2(user.address)).to.closeTo(parseUnits(unlocked2), getPrecisionLoss());
    }

    const claim = async(
        user,
        extraClaimAmount,
        totalClaimed,
        totalFee,
        totalBurned
    ) => {
        await contract.connect(user).claimWithExtra(parseUnits(extraClaimAmount));
        const userStats = await contract.users(user.address);
        expect(userStats.totalClaimed).to.closeTo(parseUnits(totalClaimed), getPrecisionLoss());
        expect(userStats.totalFee).to.closeTo(parseUnits(totalFee), getPrecisionLoss());
        expect(userStats.totalBurned).to.closeTo(parseUnits(totalBurned), getPrecisionLoss());
    }

    describe("TC 1 - daily vesting without fee", async() => {
        const linearVestingOffset = 86400 * 90;
        const linearVestingPeriod = 86400;

        before(async() => {
            await init({ 
                linearVestingOffset,
                linearVestingPeriod
            });

            await setUserStats(user1, {
                hasBatch2Delay: true,
                totalTokens: parseUnits(5000)
            });
        });

        it("verify return values", async() => {
            await time.increase(10);
            await verifyReturnValues(user1, 1000, 0, 1000, 300, 0);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingOffset + linearVestingPeriod * 70);
            await verifyReturnValues(user1, 2420, 317, 2420, 726, 700);
        });

        it("claim", async() => {
            await claim(user1, 0, 1426, 0, 0);
            await verifyReturnValues(user1, 2420, 317, 994, 0, 0);
        });
        
        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 70);
            await verifyReturnValues(user1, 3820, 0, 2394, 420, 714);
        });

        it("claim", async() => {
            await claim(user1, 0, 1426 + 1134, 0, 0);
            await verifyReturnValues(user1, 3820, 0, 1260, 0, 0);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 70);
            await verifyReturnValues(user1, 5000, 0, 2440, 354, 980);
        });

        it("claim", async() => {
            await claim(user1, 1106, 1426 + 1134 + 2440, 0, 0);
            await verifyReturnValues(user1, 5000, 0, 0, 0, 0);
        });
    });

    describe("TC 2 - daily vesting with fee", async() => {
        const linearVestingOffset = 86400 * 90;
        const linearVestingPeriod = 86400;

        before(async() => {
            await init({ 
                linearVestingOffset,
                linearVestingPeriod
            });

            await setUserStats(user1, {
                hasBatch2Delay: true,
                totalTokens: parseUnits(5000)
            });
        });

        it("verify return values", async() => {
            await time.increase(linearVestingOffset + linearVestingPeriod * 70);
            await verifyReturnValues(user1, 2420, 317, 2420, 726, 700);
        });

        it("claim without locked", async() => {
            await claim(user1, 994, 2420, 994, 0);
            await verifyReturnValues(user1, 2420, 317, 0, 0, 0);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 70);
            await verifyReturnValues(user1, 3820, 179, 406, 121, 0);
        });

        it("collect fees", async() => {
            await collectFees(user1, 994);
        });

        it("claim with locked", async() => {
            await claim(user1, 384, 2925, 1278, 400);
            await verifyReturnValues(user1, 3820, 79, 0, 0, 0);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 70);
            await verifyReturnValues(user1, 4500, 0, 396, 119, 0);
        });

        it("claim", async() => {
            await claim(user1, 277, 3322, 1278, 400);
            await verifyReturnValues(user1, 4500, 0, 0, 0, 0);
        });
        
        it("collect fees", async() => {
            await collectFees(user1, 1278);
        });
    });

    describe("TC 3 - daily vesting with no batch 2 delay ", async() => {
        const linearVestingOffset = 86400 * 90;
        const linearVestingPeriod = 86400;

        before(async() => {
            await init({
                linearVestingOffset,
                linearVestingPeriod
            });

            await setUserStats(user1, {
                hasBatch2Delay: false,
                totalTokens: parseUnits(5000)
            });
        });

        it("verify return values", async() => {
            await time.increase(10);
            await verifyReturnValues(user1, 1000, 0, 1000, 300, 700);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingOffset + linearVestingPeriod * 70);
            await verifyReturnValues(user1, 2420, 516, 2420, 726, 1694);
        });

        it("claim", async() => {
            await claim(user1, 0, 2420, 0, 0);
            await verifyReturnValues(user1, 2420, 516, 0, 0, 0);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 70)
            await verifyReturnValues(user1, 3820, 236, 1400, 420, 980);
        });
    });

    describe("TC 4 - daily vesting with elimination", async() => {
        const linearVestingOffset = 86400 * 90;
        const linearVestingPeriod = 86400;

        before(async() => {
            await init({
                linearVestingOffset,
                linearVestingPeriod
            });

            await setUserStats(user1, {
                hasBatch2Delay: false,
                totalTokens: parseUnits(5000)
            });
        });

        it("claim", async() => {
            await time.increase(linearVestingOffset + linearVestingPeriod * 70);
            await claim(user1, 0, 2420, 0, 0);
            await verifyReturnValues(user1, 2420, 516, 0, 0, 0);
        });

        it("eliminate", async() => {
            await time.increase(linearVestingPeriod * 70);
            await contract.connect(owner).eliminate([user1.address]);
            await verifyReturnValues(user1, 3820, 0, 1400, 420, 980);
        });

        it("claim", async() => {
            await claim(user1, 0, 2420 + 1400, 1180, 0);
            await verifyReturnValues(user1, 3820, 0, 0, 0, 0);
        });

        it("collect fees", async() => {
            await time.increase(linearVestingPeriod * 40);
            await collectFees(user1, 800);
        });

        it("collect fees", async() => {
            await time.increase(linearVestingPeriod * 40);
            await collectFees(user1, 1180);
        });
    });
    
    describe("TC 5 - monthly vesting", async() => {
        const linearVestingOffset = 86400 * 30;
        const linearVestingPeriod = 86400 * 30;
        const linearUnlocksCount = 9;
        const firstUnlockPercentage = 100;
        const lockedClaimableTokensOffset = 0;

        before(async() => {
            await init({
                linearVestingOffset,
                linearVestingPeriod,
                linearUnlocksCount,
                firstUnlockPercentage,
                lockedClaimableTokensOffset
            });

            await setUserStats(user1, {
                hasBatch2Delay: true,
                totalTokens: parseUnits(5000)
            });
        });
        
        it("verify return values", async() => {
            await time.increase(linearVestingPeriod);
            await verifyReturnValues(user1, 1000, 660, 1000, 300, 0);
        });

        it("claim", async() => {
            await claim(user1, 100, 400, 100, 0);
            await verifyReturnValues(user1, 1000, 700, 500, 0, 0);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 3);
            await verifyReturnValues(user1, 2500, 290, 2000, 420, 530);
        });

        it("claim", async() => {
            await claim(user1, 1340, 2690, 1150, 1160);
            await verifyReturnValues(user1, 2500, 0, 0, 0, 0);
        });
    });

    describe("TC 6 - collect fees", async() => {
        const linearVestingOffset = 86400 * 90;
        const linearVestingPeriod = 86400;

        before(async() => {
            await init({
                linearVestingOffset,
                linearVestingPeriod
            });

            await setUserStats(user1, {
                hasBatch2Delay: true,
                totalTokens: parseUnits(5000)
            });
        });

        it("claim with fee and burn", async() => {
            await time.increase(linearVestingOffset + linearVestingPeriod * 70);
            await claim(user1, 1094, 2520, 994, 400);
        });

        it("collect fees", async() => {
            await time.increase(linearVestingPeriod);
            await collectFees(user1, 20);
        });

        it("collect fees", async() => {
            await time.increase(linearVestingPeriod);
            await collectFees(user1, 40);
        });

        it("claim", async() => {
            await time.increase(linearVestingPeriod * 68);
            await claim(user1, 363, 3005, 1278, 716);
        });

        it("collect fees", async() => {
            await time.increase(linearVestingPeriod);
            await collectFees(user1, 1014);
        });

        it("collect fees", async() => {
            await time.increase(linearVestingPeriod * 50);
            await collectFees(user1, 1278);
        });
    });

    describe("TC 7 - collect fees with partial fee", async() => {
        const linearVestingOffset = 86400 * 90;
        const linearVestingPeriod = 86400;

        before(async() => {
            await init({
                linearVestingOffset,
                linearVestingPeriod
            });

            await setUserStats(user1, {
                hasBatch2Delay: true,
                totalTokens: parseUnits(5000)
            });
        });

        it("claim with fee", async() => {
            await claim(user1, 200, 500, 200, 0);
        });

        it("collect fees", async() => {
            await collectFees(user1, 200);
        });
    });
});