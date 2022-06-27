//SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "./SHOVesting.sol";

contract SHOVestingView {
    uint16 constant HUNDRED_PERCENT = 1e3;

    struct User {   
        bool hasBatch2Delay;
        uint40 eliminatedAt;
        uint128 totalTokens;
        uint128 totalFee;
        uint128 totalClaimed;
        uint128 totalClaimed1;
        uint128 totalClaimed2;
        uint128 totalClaimedFromLocked;
    }

    function _loadUser(SHOVesting shoVestingContract, address userAddress) internal view returns (User memory) {
        (
            bool hasBatch2Delay,
            uint40 eliminatedAt,
            uint128 totalTokens,
            uint128 totalFee,
            uint128 totalClaimed,
            uint128 totalClaimed1,
            uint128 totalClaimed2,
            uint128 totalClaimedFromLocked
        ) = shoVestingContract.users(userAddress);
        return User(hasBatch2Delay, eliminatedAt, totalTokens, totalFee, totalClaimed, totalClaimed1, totalClaimed2, totalClaimedFromLocked);
    }

    function getUserOptions(SHOVesting shoVestingContract, address[] calldata userAddresses) public view returns (uint[] memory userOptions) {
        userOptions = new uint[](userAddresses.length);
        for (uint i = 0; i < userAddresses.length; i++) {
            userOptions[i] = getUserOption(shoVestingContract, userAddresses[i]);
        }
    }

    function areEliminated(SHOVesting shoVestingContract, address[] calldata userAddresses) public view returns (uint[] memory eliminated) {
        eliminated = new uint[](userAddresses.length);
        for (uint i = 0; i < userAddresses.length; i++) {
            User memory user = _loadUser(shoVestingContract, userAddresses[i]);
            eliminated[i] = user.eliminatedAt;
        }
    }

    function getUserOption(SHOVesting shoVestingContract, address userAddress) public view returns (uint) {
        User memory user = _loadUser(shoVestingContract, userAddress);
        if (user.hasBatch2Delay) {
            return 2;
        } else {
            if (user.totalTokens > 0) {
                return 1;
            } else {
                return 0;
            } 
        }
    }

    function getUserInfo(
        SHOVesting shoVestingContract, 
        address userAddress
    ) public view returns ( 
        uint totalUnlocked,
        uint totalClaimed,
        uint upcomingClaimable,
        uint vested,
        uint minClaimable,
        uint maxClaimable,
        uint nextUnlockTimestamp
    ) {
        totalUnlocked = getUserTotalUnlocked(shoVestingContract, userAddress);
        totalClaimed = getUserTotalClaimed(shoVestingContract, userAddress);
        upcomingClaimable = getUserUpcomingClaimable(shoVestingContract, userAddress);
        vested = getUserVested(shoVestingContract, userAddress);
        minClaimable = getUserMinClaimable(shoVestingContract, userAddress);
        maxClaimable = getUserMaxClaimable(shoVestingContract, userAddress);
        nextUnlockTimestamp = getNextUnlockTimestamp(shoVestingContract);
    }

    function getUserTotalUnlocked(SHOVesting shoVestingContract, address userAddress) public view returns (uint) {
        User memory user = _loadUser(shoVestingContract, userAddress);
        uint vestingSchedule = shoVestingContract.getVestingSchedule(userAddress, false);
        if (vestingSchedule < user.totalFee) {
            return user.totalClaimed;
        }

        if (user.eliminatedAt > 0) {
            vestingSchedule = user.totalTokens;
        }

        uint totalUnlocked = vestingSchedule - user.totalFee;
        if (totalUnlocked < user.totalClaimed) {
            totalUnlocked = user.totalClaimed;
        }
        return totalUnlocked;
    }
    
    function getUserTotalClaimed(SHOVesting shoVestingContract, address userAddress) public view returns (uint) {
        User memory user = _loadUser(shoVestingContract, userAddress);
        return user.totalClaimed;
    }

    function getUserMinClaimable(SHOVesting shoVestingContract, address userAddress) public view returns (uint) {
        return shoVestingContract.getUnlocked1(userAddress) + shoVestingContract.getUnlocked2(userAddress);
    }

    function getUserMaxClaimable(SHOVesting shoVestingContract, address userAddress) public view returns (uint) {
        return shoVestingContract.getUnlocked(userAddress) + shoVestingContract.getLocked(userAddress);
    }

    function getUserVested(SHOVesting shoVestingContract, address userAddress) public view returns (uint) {
        User memory user = _loadUser(shoVestingContract, userAddress);
        uint totalClaimedAndFee = user.totalClaimed + user.totalFee;
        uint unlocked = shoVestingContract.getUnlocked(userAddress);
        if (user.totalTokens > totalClaimedAndFee + unlocked) {
            return user.totalTokens - (totalClaimedAndFee + unlocked);
        }
    }

    function getUserUpcomingClaimable(SHOVesting shoVestingContract, address userAddress) public view returns (uint) {
        User memory user = _loadUser(shoVestingContract, userAddress);
        if (user.eliminatedAt > 0) {
            return 0;
        }

        uint firstUnlockTokens = user.totalTokens * shoVestingContract.firstUnlockPercentage() / HUNDRED_PERCENT;
        uint linearUnlocksTokens = user.totalTokens - firstUnlockTokens;

        if (block.timestamp < shoVestingContract.startTime()) {
            return firstUnlockTokens;
        }

        uint linearVestedTime;
        if (block.timestamp > shoVestingContract.startTime() + shoVestingContract.linearVestingOffset()) {
            linearVestedTime = block.timestamp - (shoVestingContract.startTime() + shoVestingContract.linearVestingOffset());
        }

        uint linearUnlocksPassed = linearVestedTime / shoVestingContract.linearVestingPeriod() + (linearVestedTime > 0 ? 1 : 0);
        if (linearUnlocksPassed >= shoVestingContract.linearUnlocksCount()) {
            return 0;
        }

        uint currentTokens = shoVestingContract.getVestingSchedule(userAddress, false);
        uint totalClaimedAndFee = user.totalClaimed + user.totalFee;
        if (currentTokens < totalClaimedAndFee) {
            currentTokens = totalClaimedAndFee;
        }

        uint nextTokens = firstUnlockTokens + linearUnlocksTokens * (linearUnlocksPassed + 1) / shoVestingContract.linearUnlocksCount();
        if (nextTokens > currentTokens) {
            return nextTokens - currentTokens; 
        }
    }

    function getNextUnlockTimestamp(SHOVesting shoVestingContract) public view returns (uint) {
        uint currentTime = block.timestamp;
        uint startTime = shoVestingContract.startTime();
        if (currentTime < startTime) {
            return startTime;
        }

        uint linearVestingOffset = shoVestingContract.linearVestingOffset();
        if (currentTime < startTime + linearVestingOffset) {
            return startTime + linearVestingOffset;
        }

        uint linearVestingPeriod = shoVestingContract.linearVestingPeriod();
        uint linearVestedTime = currentTime - (startTime + linearVestingOffset);
        uint linearUnlocksPassed = linearVestedTime / linearVestingPeriod + (linearVestedTime > 0 ? 1 : 0);
        if (linearUnlocksPassed < shoVestingContract.linearUnlocksCount()) {
            return startTime + linearVestingOffset + linearVestingPeriod * linearUnlocksPassed;
        }
    }
}