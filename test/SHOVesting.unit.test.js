const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

describe("SHO Vesting Smart Contract", function() {
    let owner, manager, user1, user2, user3, contract, vestingToken, vestingTokenDecimals, settings;

    const PRECISION_LOSS = "10000000000000000";
    
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
    };

    describe("Deployment", async() => {
        before(async() => {
            await init();
        });

        it("sets attribute vestingToken correctly", async () => {
            expect(await contract.vestingToken()).to.equal(vestingToken.address);
        });

        it("sets attribute manager correctly", async () => {
            expect(await contract.manager()).to.equal(manager.address);
        });

        it("sets attribute startTime correctly", async () => {
            expect(await contract.startTime()).to.equal(settings.startTime);
        });

        it("sets attribute firstUnlockPercentage correctly", async () => {
            expect(await contract.firstUnlockPercentage()).to.equal(settings.firstUnlockPercentage);
        });

        it("sets attribute linearVestingOffset correctly", async () => {
            expect(await contract.linearVestingOffset()).to.equal(settings.linearVestingOffset);
        });

        it("sets attribute linearVestingPeriod correctly", async () => {
            expect(await contract.linearVestingPeriod()).to.equal(settings.linearVestingPeriod);
        });

        it("sets attribute linearUnlocksCount correctly", async () => {
            expect(await contract.linearUnlocksCount()).to.equal(settings.linearUnlocksCount);
        });

        it("sets attribute batch1Percentage correctly", async () => {
            expect(await contract.batch1Percentage()).to.equal(settings.batch1Percentage);
        });

        it("sets attribute batch2Delay correctly", async () => {
            expect(await contract.batch2Delay()).to.equal(settings.batch2Delay);
        });

        it("sets attribute balockedClaimableTokensOffsettch2Delay correctly", async () => {
            expect(await contract.lockedClaimableTokensOffset()).to.equal(settings.lockedClaimableTokensOffset);
        });

        it("sets attribute burnRate correctly", async () => {
            expect(await contract.burnRate()).to.equal(settings.burnRate);
        });
    });

    describe("setManager", async() => {
        before(async() => {
            await init();
        });

        it("reverts if the sender is not the owner", async() => {
            await expect(contract.connect(user1).setManager(owner.address)).to.be.revertedWith("Ownable");
        });

        it("sets manager", async() => {
            await contract.connect(owner).setManager(owner.address);
            expect(await contract.manager()).to.equal(owner.address);
        });
    });

    describe("setBurnRate", async() => {
        before(async() => {
            await init();
        });

        it("reverts if the sender is not the owner", async() => {
            await expect(contract.connect(user1).setBurnRate(1000)).to.be.revertedWith("Ownable");
        });

        it("reverts if lower than MIN_BURN_RATE", async() => {
            await expect(contract.connect(owner).setBurnRate(0)).to.be.revertedWith("");
        });

        it("reverts if higher than 100%", async() => {
            await expect(contract.connect(owner).setBurnRate(1001)).to.be.revertedWith("");
        });

        it("sets burnRate", async() => {
            await contract.connect(owner).setBurnRate(700);
            expect(await contract.burnRate()).to.equal(700);
        });
    });

    describe("setLockedClaimableTokensOffset", async() => {
        before(async() => {
            await init();
        });

        it("reverts if the sender is not the owner", async() => {
            await expect(contract.connect(user1).setLockedClaimableTokensOffset(1000)).to.be.revertedWith("Ownable");
        });

        it("sets lockedClaimableTokensOffset", async() => {
            await contract.connect(owner).setLockedClaimableTokensOffset(0);
            expect(await contract.lockedClaimableTokensOffset()).to.equal(0);
        });
    });

    describe("whitelist", async() => {
        let userAddresses, userTotalTokens, hasBatch2Delays, userInitialFees;

        before(async() => {
            await init();

            userAddresses = [user1.address, user2.address];
            userTotalTokens = [parseUnits(1000), parseUnits(2000)];
            hasBatch2Delays = [false, true];
            userInitialFees = [0, parseUnits(100)];
        });

        it("reverts if the sender is not the owner", async() => {
            await expect(contract.connect(user1).whitelist([], [], [], [], false)).to.be.revertedWith("Ownable");
        });

        it("whitelist batch 1", async() => {
            await contract.connect(owner).whitelist(
                userAddresses,
                userTotalTokens,
                hasBatch2Delays,
                userInitialFees,
                false
            );
        });

        it("sets users' totalTokens correctly", async() => {
            expect((await contract.users(user1.address)).totalTokens).to.equal(parseUnits(1000));
            expect((await contract.users(user2.address)).totalTokens).to.equal(parseUnits(2000));
        });

        it("sets users' hasBatch2Delay correctly", async() => {
            expect((await contract.users(user1.address)).hasBatch2Delay).to.equal(false);
            expect((await contract.users(user2.address)).hasBatch2Delay).to.equal(true);
        });

        it("sets users' totalFee correctly", async() => {
            expect((await contract.users(user1.address)).totalFee).to.equal(0);
            expect((await contract.users(user2.address)).totalFee).to.equal(parseUnits(100));
        });

        it("reverts when whitelisting already whitelisted user", async() => {
            await expect(contract.connect(owner).whitelist(
                [user1.address],
                [parseUnits(3000)],
                [false],
                [parseUnits(100)],
                true
            )).to.be.revertedWith("some users are already whitelisted");
        });

        it("whitelist batch 2", async() => {
            await contract.connect(owner).whitelist(
                [user3.address],
                [parseUnits(3000)],
                [false],
                [parseUnits(100)],
                true
            );
        });

        it("increased global totalTokens", async() => {
            expect(await contract.totalTokens()).to.equal(parseUnits(6000));
        });

        it("increased global totalFee", async() => {
            expect(await contract.totalFee()).to.equal(parseUnits(200));
        });

        it("set whitelistingAllowed to false", async() => {
            expect(await contract.whitelistingAllowed()).to.equal(false);
        });

        it("whitelisting is no longer possible", async() => {
            await expect(contract.connect(owner).whitelist([], [], [], [], false)).to.be.revertedWith("whitelisting no longer allowed");
        });
    });

    describe("eliminate", async() => {
        before(async() => {
            await init({
                startTime: Number(await time.latest()) + 10
            });
            await setUserStats(user1, {
                totalTokens: parseUnits(5000),
                totalFee: parseUnits(200),
                totalClaimed: parseUnits(1050)
            });
        });

        it("reverts before start", async() => {
            await expect(contract.connect(manager).eliminate([])).to.be.revertedWith("eliminating before start");
        });

        it("reverts if the sender is not the manager", async() => {
            await time.increase(119 * 86400 + 10);
            await expect(contract.connect(user1).eliminate([])).to.be.revertedWith("manager only");
        });

        it("eliminates", async() => {
            await contract.connect(manager).eliminate([user1.address]);
        });

        it("reverts if eliminating already eliminated user", async() => {
            await expect(contract.connect(manager).eliminate([user1.address])).to.be.revertedWith("some users are already eliminated");
        });

        it("increased user's totalFee", async() => {
            expect((await contract.users(user1.address)).totalFee).to.equal(parseUnits(3600));
        });

        it("increased global totalFee", async() => {
            expect(await contract.totalFee()).to.equal(parseUnits(3400));
        });

        it("sets user's elimatedAt correctly", async() => {
            const timeNow = Number(await time.latest());
            expect((await contract.users(user1.address)).eliminatedAt).to.closeTo(timeNow, 10);
        })
    });

    describe("collectFees", async() => {
        before(async() => {
            await init();
            await time.increase(10);
            await setUserStats(user1, {
                totalTokens: parseUnits(5000),
            });
            await contract.connect(manager).eliminate([user1.address]);
        });

        it("reverts if the sender is not the manager", async() => {
            await expect(contract.connect(user1).collectFees(parseUnits(1))).to.be.revertedWith("manager only");
        });

        it("the manager collects some fees", async() => {
            await contract.connect(manager).collectFees(parseUnits(1000));
        });

        it("the owner receives the tokens", async() => {
            expect(await vestingToken.balanceOf(owner.address)).to.equal(parseUnits(1000));
        });

        it("increased totalFeeCollected", async() => {
            expect(await contract.totalFeeCollected()).to.equal(parseUnits(1000));
        });

        it("caps at max claimable amount", async() => {
            await contract.connect(manager).collectFees(parseUnits(5000));
            expect(await contract.totalFeeCollected()).to.equal(parseUnits(4000));
        });

        it("reverts if no fees to collect", async() => {
            await expect(contract.connect(manager).collectFees(parseUnits(5000))).to.be.revertedWith("no fees to collect");
        });
    });

    describe("claim", async() => {
        before(async() => {
            await init({
                startTime: Number(await time.latest()) + 10
            });

            await setUserStats(user1, {
                totalTokens: parseUnits(5000),
            });
        });

        it("reverts when 0 claimable amount", async() => {
            await expect(contract.connect(user1).claim()).to.be.revertedWith("nothing to claim");
        });

        it("a user claims the first unlock and 1 linear unlock", async() => {
            await time.increase(settings.linearVestingOffset + 10);
            await contract.connect(user1).claim();
        });

        it("the user received the tokens", async() => {
            expect(await vestingToken.balanceOf(user1.address)).to.equal(parseUnits(1020));
        });

        it("increased user's totalClaimed1", async() => {
            expect((await contract.users(user1.address)).totalClaimed1).to.equal(parseUnits(306));
        });

        it("increased user's totalClaimed2", async() => {
            expect((await contract.users(user1.address)).totalClaimed2).to.equal(parseUnits(714));
        });

        it("increased user's totalClaimed", async() => {
            expect((await contract.users(user1.address)).totalClaimed).to.equal(parseUnits(1020));
        });

        it("increased global totalClaimed", async() => {
            expect(await contract.totalClaimed()).to.equal(parseUnits(1020));
        });

        it("hasn't increased user's totalFee", async() => {
            expect((await contract.users(user1.address)).totalFee).to.equal(0);
        });

        it("hasn't increased global totalFee", async() => {
            expect(await contract.totalFee()).to.equal(0);
        });
    });

    describe("claimFor", async() => {
        before(async() => {
            await init({
                startTime: Number(await time.latest()) + 10
            });

            await setUserStats(user1, {
                totalTokens: parseUnits(5000),
            });
        });

        it("a user claims for another user the first unlock and 1 linear unlock", async() => {
            await time.increase(settings.linearVestingOffset + 10);
            await contract.connect(user2).claimFor(user1.address);
        });

        it("the token receiver is the passed user address", async() => {
            expect(await vestingToken.balanceOf(user1.address)).to.equal(parseUnits(1020));
        });

        it("hasn't increased user's totalFee", async() => {
            expect((await contract.users(user1.address)).totalFee).to.equal(0);
        });

        it("hasn't increased global totalFee", async() => {
            expect(await contract.totalFee()).to.equal(0);
        });
    });

    describe("claimWithExtra", async() => {
        before(async() => {
            await init({
                startTime: Number(await time.latest()) + 10
            });

            await setUserStats(user1, {
                hasBatch2Delay: true,
                totalTokens: parseUnits(5000),
            });
        });

        it("reverts when requested claim amount is less than max claimable amount", async() => {
            await time.increase(settings.linearVestingOffset + 10);
            await expect(contract.connect(user1).claimWithExtra(parseUnits(1000))).to.be.revertedWith("requested claim amount > max claimable");
        });

        it("a user claims extra from batch 2", async() => {
            await contract.connect(user1).claimWithExtra(parseUnits(14));
        });

        it("increased user's totalClaimed2", async() => {
            expect((await contract.users(user1.address)).totalClaimed2).to.equal(parseUnits(714));
        });

        it("increased user's totalFee", async() => {
            expect((await contract.users(user1.address)).totalFee).to.equal(parseUnits(14));
        });

        it("hasnn't increased user's totalClaimedFromLocked", async() => {
            expect((await contract.users(user1.address)).totalClaimedFromLocked).to.equal(0);
        });

        it("a user claims from locked", async() => {
            await contract.connect(user1).claimWithExtra(parseUnits(100));
        });

        it("increased user's totalClaimedFromLocked", async() => {
            expect((await contract.users(user1.address)).totalClaimedFromLocked).to.equal(parseUnits(100));
        });

        it("increased user's totalFee", async() => {
            expect((await contract.users(user1.address)).totalFee).to.equal(parseUnits(414));
        });

        it("caps fee at user's totalTokens - (claimedFromBatch1 + claimedFromBatch2 + claimedFromLocked)", async() => {
            await time.increase(settings.linearVestingPeriod * settings.linearUnlocksCount);
            await contract.connect(user1).claimWithExtra(parseUnits(1000));
            expect((await contract.users(user1.address)).totalFee).to.equal(parseUnits(660));
        });

        describe("when burnRate is 100% ", async() => {
            before(async() => {
                await init({
                    burnRate: 1000,
                    startTime: Number(await time.latest()) + 10
                });
    
                await setUserStats(user1, {
                    totalTokens: parseUnits(5000),
                });
            });

            it("0 claimable from locked", async() => {
                await time.increase(settings.linearVestingOffset + 10);
                await expect(contract.connect(user1).claimWithExtra(parseUnits(1))).to.be.revertedWith("requested claim amount > max claimable");
            });

            it("a user claims all unlocked", async() => {
               await contract.connect(user1).claimWithExtra(parseUnits(0));
            });

            it("hasnn't increased user's totalClaimedFromLocked", async() => {
                expect((await contract.users(user1.address)).totalClaimedFromLocked).to.equal(0);
            });
        });
    });

    describe("getVestingSchedule", async() => {
        before(async() => {
            await init({
                startTime: Number(await time.latest()) + 10
            });
            await setUserStats(user1, {
                totalTokens: parseUnits(5000),
            });
        });

        it("before start", async() => {
            expect(await contract.getVestingSchedule(user1.address, false)).to.equal(0);
        });

        it("after start", async() => {
            await time.increase(10);
            expect(await contract.getVestingSchedule(user1.address, false)).to.equal(parseUnits(1000));
        });

        it("after offset", async() => {
            await time.increase(settings.linearVestingOffset);
            expect(await contract.getVestingSchedule(user1.address, false)).to.equal(parseUnits(1000 + 20));
        });

        it("after vesting period ends", async() => {
            await time.increase(settings.linearVestingPeriod * settings.linearUnlocksCount);
            expect(await contract.getVestingSchedule(user1.address, false)).to.equal(parseUnits(5000));
        });

        it("forBatch2 true", async() => {
            expect(await contract.getVestingSchedule(user1.address, true)).to.equal(parseUnits(5000 - 20 * 89));
        });
    });

    describe("getUnlocked", async() => {
        before(async() => {
            await init();
            await setUserStats(user1, {
                totalTokens: parseUnits(5000),
                totalFee: parseUnits(200),
                totalClaimed: parseUnits(1050)
            });
        });

        it("when user's vestingSchedule is less than totalClaimed + totalFee", async() => {
            expect(await contract.getUnlocked(user1.address)).to.equal(0);
        });

        it("when not eliminated", async() => {
            await time.increase(settings.linearVestingOffset + 100 * settings.linearVestingPeriod);
            expect(await contract.getUnlocked(user1.address)).to.equal(parseUnits(1770));
        });

        it("when eliminated", async() => {
            await contract.connect(manager).eliminate([user1.address]);
            await time.increase(200 * settings.linearVestingPeriod);
            expect(await contract.getUnlocked(user1.address)).to.equal(parseUnits(1770)); 
        });
    });

    describe("getLocked", async() => {
        before(async() => {
            await init();
            await setUserStats(user1, {
                totalTokens: parseUnits(5000),
                totalFee: parseUnits(200),
                totalClaimed: parseUnits(1050)
            });
        });

        it("before lockedClaimableTokensOffset", async() => {
            expect(await contract.getLocked(user1.address)).to.equal(0);
        });

        it("after lockedClaimableTokensOffset", async() => {
            await time.increase(settings.lockedClaimableTokensOffset);
            expect(await contract.getLocked(user1.address)).to.equal(parseUnits(3750 * (1e3 - settings.burnRate) / 1e3));
        });

        it("when totalClaimed and totalFee is greater than totalTokens", async() => {
            await setUserStats(user1, {
                totalTokens: parseUnits(5000),
                totalFee: parseUnits(3000),
                totalClaimed: parseUnits(3000)
            });
            expect(await contract.getLocked(user1.address)).to.equal(0);
        });
    });

    describe("getUnlocked1", async() => {
        before(async() => {
            await init();
            await setUserStats(user1, {
                hasBatch2Delay: true,
                totalTokens: parseUnits(5000),
                totalFee: parseUnits(582),
                totalClaimed: parseUnits(1360),
                totalClaimed1: parseUnits(378),
                totalClaimed2: parseUnits(882),
                totalClaimedFromLocked: parseUnits(100)
            });
            await time.increase(settings.linearVestingOffset + settings.linearVestingPeriod * 100);
        });

        it("when not eliminated", async() => {
            expect(await contract.getUnlocked1(user1.address)).to.equal(parseUnits(323.4));
        });

        it("when eliminated", async() => {
            await contract.connect(manager).eliminate([user1.address]);
            await time.increase(settings.linearVestingPeriod);
            expect(await contract.getUnlocked1(user1.address)).to.equal(parseUnits(323.4));
        });

        it("when user's vestingSchedule is less than totalClaimed + totalFee", async() => {
            await setUserStats(user1, {
                totalTokens: parseUnits(5000),
                totalFee: parseUnits(2000),
                totalClaimed1: parseUnits(500),
                totalClaimedFromLocked: parseUnits(2000)
            });
            await time.increase(settings.linearVestingPeriod * 100);
            expect(await contract.getUnlocked1(user1.address)).to.equal(0);
        });
    });

    describe("getUnlocked2", async() => {
        before(async() => {
            await init();
            await setUserStats(user1, {
                hasBatch2Delay: true,
                totalTokens: parseUnits(5000),
                totalFee: parseUnits(582),
                totalClaimed: parseUnits(1360),
                totalClaimed1: parseUnits(378),
                totalClaimed2: parseUnits(882),
                totalClaimedFromLocked: parseUnits(100)
            });
            await time.increase(settings.linearVestingOffset + settings.linearVestingPeriod * 100);
        });

        it("when not eliminated and has 0 available from batch 2", async() => {
            expect(await contract.getUnlocked2(user1.address)).to.equal(0);
        });

        it("when not eliminated and has 0 available from batch 2", async() => {
            await time.increase(settings.linearVestingPeriod * 50);
            expect(await contract.getUnlocked2(user1.address)).to.equal(parseUnits(194.6));
        });

        it("when eliminated", async() => {
            await contract.connect(manager).eliminate([user1.address]);
            await time.increase(settings.linearVestingPeriod);
            expect(await contract.getUnlocked2(user1.address)).to.equal(parseUnits(1454.6));
        });

        it("when user's vestingSchedule is less than totalClaimed + totalFee", async() => {
            await setUserStats(user1, {
                totalTokens: parseUnits(5000),
                totalFee: parseUnits(2000),
                totalClaimed2: parseUnits(800),
                totalClaimedFromLocked: parseUnits(2000)
            });
            await time.increase(settings.linearVestingPeriod * 100);
            expect(await contract.getUnlocked2(user1.address)).to.equal(0);
        });
    });

    describe("getVestedtime", async() => {
        before(async() => {
            await init({
                startTime: Number(await time.latest()) + 10
            });
        });

        it("before startTime", async() => {
            expect(Number(await contract.getVestedTime(false))).to.equal(0);
        })

        it("after startTime false", async() => {
            await time.increase(120 * 86400 + 10);
            expect(Number(await contract.getVestedTime(false))).to.closeTo(120 * 86400, 10);
        });

        it("forBatch2 true", async() => {
            expect(Number(await contract.getVestedTime(true))).to.closeTo((120 - settings.batch2Delay / 86400) * 86400, 10);
        });
    });

    describe("getLinearVestedTime", async() => {
        const additionalVestedTime = 100 * 86400;

        before(async() => {
            await init();
        });

        it("before linearVestingOffset", async() => {
            await time.increase(settings.linearVestingOffset - 86400);
            expect(Number(await contract.getLinearVestedTime(false))).to.equal(0);
        });

        it("after linearVestingOffset", async() => {
            await time.increaseTo(settings.startTime + settings.linearVestingOffset + additionalVestedTime);
            expect(Number(await contract.getLinearVestedTime(false))).to.closeTo(additionalVestedTime, 10);
        });

        it("forBatch2 true", async() => {
            expect(Number(await contract.getLinearVestedTime(true))).to.closeTo(additionalVestedTime - settings.batch2Delay, 10);
        });
    });

    describe("getLinearUnlocksPassed", async() => {
        before(async() => {
            await init();
        });

        it("when linearVestingTime is 0", async() => {
            expect(Number(await contract.getLinearUnlocksPassed(false))).to.equal(0);
        });

        it("when linearVestingTime is greater than 0 but less than linearVestingPeriod", async() => {
            await time.increase(settings.linearVestingOffset + 0.5 * settings.linearVestingPeriod);
            expect(Number(await contract.getLinearUnlocksPassed(false))).to.equal(1);
        });

        it("when linearVestingTime is greate than 1 linearVestingPeriod", async() => {
            await time.increase(1 * settings.linearVestingPeriod);
            expect(Number(await contract.getLinearUnlocksPassed(false))).to.equal(2);
        });

        it("forBatch2 true", async() => {
            await time.increase(100 * settings.linearVestingPeriod);
            expect(Number(await contract.getLinearUnlocksPassed(true))).to.equal(12);
        });

        it("caps at max linearUnlocksCount", async() => {
            await time.increase((settings.linearUnlocksCount + 10) * settings.linearVestingPeriod);
            expect(Number(await contract.getLinearUnlocksPassed(false))).to.equal(settings.linearUnlocksCount);
        });
    });
});