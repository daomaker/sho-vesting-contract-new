//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../SHOVesting.sol";

contract SHOVestingMock is SHOVesting {
    constructor(
        IERC20 _vestingToken,
        address _eliminator,
        uint _startTime,
        uint _firstUnlockPercentage,
        uint _linearVestingOffset,
        uint _linearVestingPeriod,
        uint _linearUnlocksCount,
        uint _batch1Percentage,
        uint _batch2Delay,
        uint40 _lockedClaimableTokensOffset,
        uint16 _burnRate
    ) SHOVesting (
        _vestingToken,
        _eliminator,
        _startTime,
        _firstUnlockPercentage,
        _linearVestingOffset,
        _linearVestingPeriod,
        _linearUnlocksCount,
        _batch1Percentage,
        _batch2Delay,
        _lockedClaimableTokensOffset,
        _burnRate
    ) {

    }
    
    function setUserStats(
        address userAddress,
        bool hasBatch2Delay,
        uint40 eliminatedAt,
        uint128 totalTokens,
        uint128 totalFee,
        uint128 totalBurned,
        uint128 totalClaimed,
        uint128 totalClaimed1,
        uint128 totalClaimed2,
        uint128 totalClaimedFromLocked
    ) external {
        users[userAddress] = User(
            hasBatch2Delay,
            eliminatedAt,
            totalTokens,
            totalFee,
            totalBurned,
            totalClaimed,
            totalClaimed1,
            totalClaimed2,
            totalClaimedFromLocked,
            0
        );
    }

    function getVestedTime(bool forBatch2) public view returns (uint) {
        return _getVestedTime(forBatch2);
    }

    function getLinearVestedTime(bool forBatch2) public view returns (uint) {
        return _getLinearVestedTime(forBatch2);
    }

    function getLinearUnlocksPassed(bool forBatch2) public view returns (uint) {
        return _getLinearUnlocksPassed(forBatch2);
    }
}
