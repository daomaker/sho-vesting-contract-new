const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

describe("SHO Vesting Smart Contract", function() {
    let owner, manager, user1, user2, user3, contract, contractView, vestingToken, vestingTokenDecimals, settings;
    
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
        [owner, manager, user1, user2, user3] = await ethers.getSigners();

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
            manager.address,
            settings.startTime,
            settings.firstUnlockPercentage,
            settings.linearVestingOffset,
            settings.linearVestingPeriod,
            settings.linearUnlocksCount,
            settings.batch1Percentage,
            settings.batch2Delay,
            settings.lockedClaimableTokensOffset,
            settings.burnRate
        );

        await vestingToken.transfer(contract.address, parseUnits(100000000));

        const SHOVestingView = await ethers.getContractFactory("SHOVestingView");
        contractView = await SHOVestingView.deploy();
    }

    const setUserStats = async(user, stats = {}) => {
        await contract.setUserStats(
            user.address,
            stats.hasBatch2Delay ?? false,
            stats.eliminatedAt ?? 0,
            stats.totalTokens ?? parseUnits(5000),
            stats.totalFee ?? parseUnits(0),
            stats.totalClaimed ?? parseUnits(0),
            stats.totalClaimed1 ?? 0,
            stats.totalClaimed2 ?? 0,
            stats.totalClaimedFromLocked ?? 0,
        );
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

    const verifyReturnValues2 = async(
        user, 
        totalUnlocked,
        totalClaimed,
        upcomingClaimable,
        vested,
        minClaimable,
        maxClaimable,
        nextUnlockTimestamp
    ) => {
        const userInfo = await contractView.getUserInfo(contract.address, user.address);
        expect(userInfo.totalUnlocked).to.closeTo(parseUnits(totalUnlocked), getPrecisionLoss());
        expect(userInfo.totalClaimed).to.closeTo(parseUnits(totalClaimed), getPrecisionLoss());
        expect(userInfo.upcomingClaimable).to.closeTo(parseUnits(upcomingClaimable), getPrecisionLoss());
        expect(userInfo.vested).to.closeTo(parseUnits(vested), getPrecisionLoss());
        expect(userInfo.minClaimable).to.closeTo(parseUnits(minClaimable), getPrecisionLoss());
        expect(userInfo.maxClaimable).to.closeTo(parseUnits(maxClaimable), getPrecisionLoss());
        expect(Number(userInfo.nextUnlockTimestamp)).to.closeTo(nextUnlockTimestamp, 10);
    }

    const claim = async(
        user,
        extraClaimAmount,
        totalClaimed,
        totalFee
    ) => {
        await contract.connect(user).claimWithExtra(parseUnits(extraClaimAmount));
        const userStats = await contract.users(user.address);
        expect(userStats.totalClaimed).to.closeTo(parseUnits(totalClaimed), getPrecisionLoss());
        expect(userStats.totalFee).to.closeTo(parseUnits(totalFee), getPrecisionLoss());
    }

    describe("TC 1 - daily vesting without fee", async() => {
        const linearVestingOffset = 86400 * 90;
        const linearVestingPeriod = 86400;

        before(async() => {
            await init({ 
                startTime: Number(await time.latest()) + 10,
                linearVestingOffset,
                linearVestingPeriod
            });

            await setUserStats(user1, {
                hasBatch2Delay: true,
                totalTokens: parseUnits(5000)
            });
        });

        it("verify return values", async() => {
            await verifyReturnValues2(user1, 0, 0, 1000, 5000, 0, 0, settings.startTime);
            await time.increase(10);
            await verifyReturnValues(user1, 1000, 0, 1000, 300, 0);
            await verifyReturnValues2(user1, 1000, 0, 20, 4000, 300, 1000, settings.startTime + settings.linearVestingOffset);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingOffset + linearVestingPeriod * 70);
            await verifyReturnValues(user1, 2420, 317, 2420, 726, 700);
            await verifyReturnValues2(user1, 2420, 0, 20, 2580, 1426, 2737, settings.startTime + settings.linearVestingOffset + settings.linearVestingPeriod * 71);
        });

        it("claim", async() => {
            await claim(user1, 0, 1426, 0);
            await verifyReturnValues(user1, 2420, 317, 994, 0, 0);
            await verifyReturnValues2(user1, 2420, 1426, 20, 2580, 0, 1311, settings.startTime + settings.linearVestingOffset + settings.linearVestingPeriod * 71);
        });
        
        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 70);
            await verifyReturnValues(user1, 3820, 0, 2394, 420, 714);
            await verifyReturnValues2(user1, 3820, 1426, 20, 1180, 1134, 2394, settings.startTime + settings.linearVestingOffset + settings.linearVestingPeriod * 141);
        });

        it("claim", async() => {
            await claim(user1, 0, 2560, 0);
            await verifyReturnValues(user1, 3820, 0, 1260, 0, 0);
            await verifyReturnValues2(user1, 3820, 2560, 20, 1180, 0, 1260, settings.startTime + settings.linearVestingOffset + settings.linearVestingPeriod * 141);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 70);
            await verifyReturnValues(user1, 5000, 0, 2440, 354, 980);
            await verifyReturnValues2(user1, 5000, 2560, 0, 0, 1334, 2440, 0);
        });

        it("claim", async() => {
            await claim(user1, 1106, 5000, 0);
            await verifyReturnValues(user1, 5000, 0, 0, 0, 0);
            await verifyReturnValues2(user1, 5000, 5000, 0, 0, 0, 0, 0);
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
            await verifyReturnValues2(user1, 2420, 0, 20, 2580, 1426, 2737, settings.startTime + settings.linearVestingOffset + settings.linearVestingPeriod * 71);
        });

        it("claim", async() => {
            await claim(user1, 994, 2420, 994);
            await verifyReturnValues(user1, 2420, 317, 0, 0, 0);
            await verifyReturnValues2(user1, 2420, 2420, 0, 1586, 0, 317, settings.startTime + settings.linearVestingOffset + settings.linearVestingPeriod * 71);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 49);
            await verifyReturnValues2(user1, 2420, 2420, 6, 1586, 0, 317, settings.startTime + settings.linearVestingOffset + settings.linearVestingPeriod * 120);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 21);
            await verifyReturnValues(user1, 3820, 179, 406, 121, 0);
            await verifyReturnValues2(user1, 2826, 2420, 20, 1180, 122, 585, settings.startTime + settings.linearVestingOffset + settings.linearVestingPeriod * 141);
        });

        it("claim", async() => {
            await claim(user1, 384, 2925, 1678);
            await verifyReturnValues(user1, 3820, 79, 0, 0, 0);
            await verifyReturnValues2(user1, 2925, 2925, 0, 397, 0, 79, settings.startTime + settings.linearVestingOffset + settings.linearVestingPeriod * 141);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 70);
            await verifyReturnValues(user1, 5000, 0, 396, 119, 0);
            await verifyReturnValues2(user1, 3322, 2925, 0, 0, 119, 396, 0);
        });

        it("claim", async() => {
            await claim(user1, 277, 3322, 1678);
            await verifyReturnValues(user1, 5000, 0, 0, 0, 0);
            await verifyReturnValues2(user1, 3322, 3322, 0, 0, 0, 0, 0);
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
            await verifyReturnValues2(user1, 1000, 0, 20, 4000, 1000, 1000, settings.startTime + settings.linearVestingOffset);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingOffset + linearVestingPeriod * 70);
            await verifyReturnValues(user1, 2420, 516, 2420, 726, 1694);
            await verifyReturnValues2(user1, 2420, 0, 20, 2580, 2420, 2936, settings.startTime + settings.linearVestingOffset + linearVestingPeriod * 71);
        });

        it("claim", async() => {
            await claim(user1, 0, 2420, 0);
            await verifyReturnValues(user1, 2420, 516, 0, 0, 0);
            await verifyReturnValues2(user1, 2420, 2420, 20, 2580, 0, 516, settings.startTime + settings.linearVestingOffset + linearVestingPeriod * 71);

        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 70)
            await verifyReturnValues(user1, 3820, 236, 1400, 420, 980);
            await verifyReturnValues2(user1, 3820, 2420, 20, 1180, 1400, 1636, settings.startTime + settings.linearVestingOffset + linearVestingPeriod * 141);
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
            await claim(user1, 0, 2420, 0);
            await verifyReturnValues(user1, 2420, 516, 0, 0, 0);
        });

        it("eliminate", async() => {
            await time.increase(linearVestingPeriod * 70);
            await contract.connect(manager).eliminate([user1.address]);
            await verifyReturnValues(user1, 3820, 0, 1400, 420, 980);
            await verifyReturnValues2(user1, 3820, 2420, 0, 0, 1400, 1400, settings.startTime + settings.linearVestingOffset + linearVestingPeriod * 141);
        });

        it("claim", async() => {
            await claim(user1, 0, 2420 + 1400, 1180);
            await verifyReturnValues(user1, 3820, 0, 0, 0, 0);
            await verifyReturnValues2(user1, 3820, 3820, 0, 0, 0, 0, settings.startTime + settings.linearVestingOffset + linearVestingPeriod * 141);
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
            await verifyReturnValues2(user1, 1000, 0, 500, 4000, 300, 1660, settings.startTime + linearVestingPeriod * 2);
        });

        it("claim", async() => {
            await claim(user1, 100, 400, 100);
            await verifyReturnValues(user1, 1000, 700, 500, 0, 0);
            await verifyReturnValues2(user1, 900, 400, 500, 4000, 0, 1200, settings.startTime + linearVestingPeriod * 2);
        });

        it("verify return values", async() => {
            await time.increase(linearVestingPeriod * 3);
            await verifyReturnValues(user1, 2500, 290, 2000, 420, 530);
            await verifyReturnValues2(user1, 2400, 400, 500, 2500, 950, 2290, settings.startTime + linearVestingPeriod * 5);
        });

        it("claim", async() => {
            await claim(user1, 1340, 2690, 2310);
            await verifyReturnValues(user1, 2500, 0, 0, 0, 0);
            await verifyReturnValues2(user1, 2690, 2690, 0, 0, 0, 0, settings.startTime + linearVestingPeriod * 5);
        });
    });
});