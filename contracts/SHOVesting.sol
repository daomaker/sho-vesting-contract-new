//SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract SHOVesting is Ownable, ReentrancyGuard {
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

    uint constant HUNDRED_PERCENT = 1e3;    
    uint constant MIN_BURN_RATE = 6e2; 

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

    IERC20 public immutable vestingToken;
    uint public immutable startTime;
    uint public immutable firstUnlockPercentage;
    uint public immutable linearVestingOffset;
    uint public immutable linearVestingPeriod;
    uint public immutable linearUnlocksCount;
    uint public immutable batch1Percentage;
    uint public immutable batch2Delay;

    address public eliminator;
    uint128 public totalTokens;
    uint128 public totalClaimed;
    uint128 public totalFee;
    uint128 public totalFeeCollected;
    uint40 public lockedClaimableTokensOffset;
    uint16 public burnRate;
    bool public whitelistingAllowed = true;

    mapping (address => User) public users;

    event Whitelist(address userAddress, uint totalTokens, bool hasBatch2Delay, uint initialFee);
    event Elimination(address userAddress, uint fee, uint eliminatedAt);
    event CollectFees(uint amount);
    event Claim(address userAddress, uint claimAmount, uint baseClaimAmount, uint fee, uint feeFromBatch2);

    modifier onlyEliminator() {
        require(msg.sender == eliminator, "eliminator only");
        _;
    }

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
    ) {
        require(address(_vestingToken) != address(0));
        require(_eliminator != address(0));
        require(_firstUnlockPercentage >= 0 && _firstUnlockPercentage <= HUNDRED_PERCENT);
        require(_linearVestingPeriod > 0);
        require(_linearUnlocksCount > 0);
        require(_batch1Percentage >= 0 && _batch1Percentage <= HUNDRED_PERCENT);
        require(_burnRate >= MIN_BURN_RATE && _burnRate <= HUNDRED_PERCENT);

        vestingToken = _vestingToken;
        eliminator = _eliminator;
        startTime = _startTime;
        firstUnlockPercentage = _firstUnlockPercentage;
        linearVestingOffset = _linearVestingOffset;
        linearVestingPeriod = _linearVestingPeriod;
        linearUnlocksCount = _linearUnlocksCount;
        batch1Percentage = _batch1Percentage;
        batch2Delay = _batch2Delay;
        lockedClaimableTokensOffset = _lockedClaimableTokensOffset;
        burnRate = _burnRate;
    }

    // =================== RISTRICTED ASCCESS FUNCTIONS  =================== //

    function setEliminator(address _eliminator) external onlyOwner {
        require(_eliminator != address(0));
        eliminator = _eliminator;
    }

    function setBurnRate(uint16 _burnRate) external onlyOwner {
        require(_burnRate >= MIN_BURN_RATE && _burnRate <= HUNDRED_PERCENT);
        burnRate = _burnRate;
    }

    function setLockedClaimableTokensOffset(uint40 _lockedClaimableTokensOffset) external onlyOwner {
        lockedClaimableTokensOffset = _lockedClaimableTokensOffset;
    }
    
    function whitelist(
        address[] calldata userAddresses,
        uint128[] calldata userTotalTokens,
        bool[] calldata hasBatch2Delays,
        uint128[] calldata userInitialFees,
        bool last
    ) external onlyOwner {
        require(whitelistingAllowed, "whitelisting no longer allowed");
        require(userAddresses.length != 0, "zero length array");
        require(userAddresses.length == userTotalTokens.length, "different array lengths");
        require(userAddresses.length == hasBatch2Delays.length, "different array lengths");
        require(userAddresses.length == userInitialFees.length, "different array lengths");

        uint128 _totalTokens;
        uint128 _totalFee;
        for (uint i = 0; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            require(users[userAddress].totalTokens == 0, "some users are already whitelisted");

            users[userAddress].totalTokens = userTotalTokens[i];
            users[userAddress].hasBatch2Delay = hasBatch2Delays[i];
            users[userAddress].totalFee = userInitialFees[i];
            _totalTokens += userTotalTokens[i];
            _totalFee += userInitialFees[i];
            emit Whitelist(userAddress, userTotalTokens[i], hasBatch2Delays[i], userInitialFees[i]);
        }
        totalTokens += _totalTokens;
        totalFee += _totalFee;

        if (last) {
            whitelistingAllowed = false;
        }
    }

    function eliminate(address[] calldata userAddresses) external onlyEliminator {
        for (uint i = 0; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            User storage user = users[userAddress];
            require(user.eliminatedAt == 0, "some users are already eliminated");

            uint total = user.totalClaimed + user.totalFee + getUnlocked(userAddress);
            uint fee;
            if (user.totalTokens > total) {
                fee = user.totalTokens - total;
                user.totalFee += fee.toUint128();
                totalFee += fee.toUint128();
            }
            user.eliminatedAt = uint40(block.timestamp);
            emit Elimination(userAddress, fee, block.timestamp);
        }
    }

    // =================== EXTERNAL FUNCTIONS  =================== //

    function collectFees(uint128 amount) external nonReentrant {
        uint128 maxCollectable = totalFee - totalFeeCollected;
        if (amount > maxCollectable) {
            amount = maxCollectable;
        }
        require(amount > 0, "no fees to collect");

        totalFeeCollected += amount;
        vestingToken.safeTransfer(owner(), amount);
        emit CollectFees(amount);
    }

    function claim() external {
        _claim(msg.sender, 0);
    }

    function claimFor(address userAddress) external {
        _claim(userAddress, 0);
    }

    function claimWithExtra(uint128 extraClaimAmount) external {
        _claim(msg.sender, extraClaimAmount);
    }

    // =================== INTERNAL FUNCTIONS  =================== //
    
    function _claim(address userAddress, uint128 extraClaimAmount) internal nonReentrant {
        User storage user = users[userAddress];
        uint unlocked = getUnlocked(userAddress);
        uint unlocked1 = getUnlocked1(userAddress);
        uint unlocked2 = getUnlocked2(userAddress);

        uint baseClaimAmount = unlocked1 + unlocked2;
        uint claimAmount = baseClaimAmount + extraClaimAmount;
        uint maxClaimableAmount = unlocked + getLocked(userAddress);

        require(claimAmount > 0, "nothing to claim");
        require(claimAmount < maxClaimableAmount, "requested claim amount > max claimable");

        uint claimedFromBatch1 = unlocked1;
        uint claimedFromBatch2 = claimAmount - claimedFromBatch1;
        if (claimedFromBatch2 > unlocked - unlocked1) {
            claimedFromBatch2 = unlocked - unlocked1;
        }
        uint feeFromBatch2 = claimedFromBatch2 - unlocked2;

        uint claimedFromLocked = claimAmount - claimedFromBatch1 - claimedFromBatch2;
        uint feeFromLocked;
        if (burnRate < HUNDRED_PERCENT) {
            feeFromLocked = claimedFromLocked * burnRate / (HUNDRED_PERCENT - burnRate);
        }
        uint fee = feeFromBatch2 + feeFromLocked;

        user.totalClaimed1 += claimedFromBatch1.toUint128();
        user.totalClaimed2 += claimedFromBatch2.toUint128();
        user.totalClaimedFromLocked += claimedFromLocked.toUint128();
        user.totalFee += fee.toUint128();
        totalFee += fee.toUint128();
        totalClaimed += claimAmount.toUint128();

        vestingToken.safeTransfer(userAddress, claimAmount);
        emit Claim(userAddress, claimAmount, baseClaimAmount, fee, feeFromBatch2);
    }

    // =================== VIEW FUNCTIONS  =================== //

    function getVestingSchedule(address userAddress, bool forBatch2) public view returns (uint) {
        User storage user = users[userAddress];
        uint vestedTime = _getVestedTime(forBatch2);
        if (vestedTime == 0) {
            return 0;
        }
        
        uint firstUnlockTokens = _applyPercentage(user.totalTokens, firstUnlockPercentage);
        uint linearUnlocksTokens = user.totalTokens - firstUnlockTokens;
        uint linearUnlocksPassed = _getLinearUnlocksPassed(forBatch2);

        return firstUnlockTokens + linearUnlocksTokens * linearUnlocksPassed / linearUnlocksCount;
    }

    function getUnlocked(address userAddress) public view returns (uint) {
        User storage user = users[userAddress];
        uint vestingSchedule = getVestingSchedule(userAddress, false);
        if (user.eliminatedAt > 0) {
            vestingSchedule = user.totalTokens;
        }

        uint totalClaimedAndFee = user.totalClaimed + user.totalFee;
        if (vestingSchedule > totalClaimedAndFee) {
            return vestingSchedule - totalClaimedAndFee;
        }
    }

    function getLocked(address userAddress) public view returns (uint) {
        User storage user = users[userAddress];
        uint vestedTime = _getVestedTime(false);
        if (vestedTime < lockedClaimableTokensOffset) {
            return 0;
        }
        
        uint totalClaimedAndFee = user.totalClaimed + user.totalFee;
        uint unlocked = getUnlocked(userAddress);
        if (user.totalTokens > totalClaimedAndFee + unlocked) {
            uint locked = user.totalTokens - (totalClaimedAndFee + unlocked);
            return _applyPercentage(locked, HUNDRED_PERCENT - burnRate);
        }
    }

    function getUnlocked1(address userAddress) public view returns (uint) {
        User storage user = users[userAddress];
        if (user.eliminatedAt > 0) {
            return _applyPercentage(getUnlocked(userAddress), batch1Percentage); 
        } 
            
        uint vestingSchedule = _applyPercentage(getVestingSchedule(userAddress, false), batch1Percentage);
        uint totalClaimed1AndFee = user.totalClaimed1 + _applyPercentage(user.totalFee, batch1Percentage) + _applyPercentage(user.totalClaimedFromLocked, batch1Percentage);
        if (vestingSchedule > totalClaimed1AndFee) {
            return vestingSchedule - totalClaimed1AndFee;
        }
    }

    function getUnlocked2(address userAddress) public view returns (uint) {
        User storage user = users[userAddress];
        uint batch2Percentage = HUNDRED_PERCENT - batch1Percentage;
        if (user.eliminatedAt > 0) {
            return _applyPercentage(getUnlocked(userAddress), batch2Percentage); 
        }

        uint vestingSchedule = _applyPercentage(getVestingSchedule(userAddress, user.hasBatch2Delay), batch2Percentage);
        uint totalClaimed2AndFee = user.totalClaimed2 + _applyPercentage(user.totalFee, batch2Percentage) + _applyPercentage(user.totalClaimedFromLocked, batch2Percentage);
        if (vestingSchedule > totalClaimed2AndFee) {
            return vestingSchedule - totalClaimed2AndFee;
        }
    }

    function _getVestedTime(bool forBatch2) internal view returns (uint) {
        uint currentTime = block.timestamp;
        if (currentTime > startTime + (forBatch2 ? batch2Delay : 0)) {
            return currentTime - (startTime + (forBatch2 ? batch2Delay : 0));
        }
    }

    function _getLinearVestedTime(bool forBatch2) internal view returns (uint) {
        uint vestedTime = _getVestedTime(forBatch2);
        if (vestedTime > linearVestingOffset) {
            return vestedTime - linearVestingOffset;
        }
    }

    function _getLinearUnlocksPassed(bool forBatch2) internal view returns (uint) {
        uint linearVestedTime = _getLinearVestedTime(forBatch2);
        uint linearUnlocksPassed = linearVestedTime / linearVestingPeriod + (linearVestedTime > 0 ? 1 : 0);
        if (linearUnlocksPassed > linearUnlocksCount) {
            linearUnlocksPassed = linearUnlocksCount;
        }
        return linearUnlocksPassed;
    }

    function _applyPercentage(uint value, uint percentage) internal pure returns (uint) {
        return value * percentage / HUNDRED_PERCENT;
    }
}