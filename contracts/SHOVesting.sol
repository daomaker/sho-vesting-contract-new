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
        uint128 totalBurned;
        uint128 totalClaimed;
        uint128 totalClaimed1;
        uint128 totalClaimed2;
        uint128 totalClaimedFromUnlocked;
        uint128 totalClaimedFromLocked;
        uint128 totalFeeCollected;
    }
    mapping (address => User) public users;

    IERC20 public immutable vestingToken;
    uint public immutable startTime;
    uint public immutable firstUnlockPercentage;
    uint public immutable linearVestingOffset;
    uint public immutable linearVestingPeriod;
    uint public immutable linearUnlocksCount;
    uint public immutable batch1Percentage;
    uint public immutable batch2Delay;

    address public manager;
    uint40 public lockedClaimableTokensOffset;
    uint16 public burnRate;
    bool public whitelistingAllowed = true;

    uint128 public totalTokens;
    uint128 public totalClaimed;
    uint128 public totalFee;
    uint128 public totalBurned;
    uint128 public totalFeeCollected;

    event Whitelist(address userAddress, uint totalTokens, bool hasBatch2Delay, uint initialFee);
    event Elimination(address userAddress, uint fee, uint eliminatedAt);
    event CollectFees(uint amount);
    event Claim(address userAddress, uint claimAmount, uint cappedFee, uint baseClaimAmount, uint burned);

    modifier onlyManager() {
        require(msg.sender == manager, "manager only");
        _;
    }

    constructor(
        IERC20 _vestingToken,
        address _manager,
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
        require(_manager != address(0));
        require(_firstUnlockPercentage <= HUNDRED_PERCENT);
        require(_linearVestingPeriod > 0);
        require(_linearUnlocksCount > 0);
        require(_batch1Percentage <= HUNDRED_PERCENT);
        require(_burnRate >= MIN_BURN_RATE && _burnRate <= HUNDRED_PERCENT);

        vestingToken = _vestingToken;
        manager = _manager;
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

    function setManager(address _manager) external {
        require(msg.sender == owner() || msg.sender == manager, "manager or owner only");
        require(_manager != address(0));
        manager = _manager;
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

    function eliminate(address[] calldata userAddresses) external onlyManager {
        require(_getVestedTime(false) > 0, "eliminating before start");
        
        for (uint i = 0; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            User storage user = users[userAddress];
            require(user.eliminatedAt == 0, "some users are already eliminated");

            uint total = user.totalClaimed + user.totalFee + user.totalBurned + getUnlocked(userAddress);
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
    
    /**
        Sends all collectable fees to the owner. The fees are collected with respect to the vesting schedule.
        @param userAddresses array of addresses to collect the fees from
     */
    function collectFees(address[] calldata userAddresses) external {
        uint fees;
        for (uint i = 0; i < userAddresses.length; i++) {
            address userAddress = userAddresses[i];
            User storage user = users[userAddress];
            uint fee = getVestingSchedule(userAddress, false) - getUnlocked(userAddress) - user.totalClaimedFromUnlocked - user.totalFeeCollected;
            require(fee > 0, "some users dont have any fee to collect");
            user.totalFeeCollected += fee.toUint128();
            fees += fee;
        }

        totalFeeCollected += fees.toUint128();
        vestingToken.safeTransfer(owner(), fees);
        emit CollectFees(fees);
    }

    /**
        The sender claims all his free available tokens.
     */
    function claim() external {
        _claim(msg.sender, 0);
    }

    /**
        The sender claims free available tokens for another wallet. The token receiver is the wallet, not the sender.
        @param userAddress the address to claim for
     */
    function claimFor(address userAddress) external {
        _claim(userAddress, 0);
    }

    /**
        The sender claims all his free available tokens, requests to claim a certain extra amount and is charged a fee.
        @param extraClaimAmount extra amount
     */
    function claimWithExtra(uint128 extraClaimAmount) external {
        return _claim(msg.sender, extraClaimAmount);
    }

    // =================== INTERNAL FUNCTIONS  =================== //
    
    function _claim(address userAddress, uint128 extraClaimAmount) internal nonReentrant {
        User storage user = users[userAddress];
        (
            uint baseClaimAmount,
            uint claimAmount,
            uint claimedFromBatch1, 
            uint claimedFromBatch2, 
            uint claimedFromLocked,
            uint cappedFee,
            uint burned
        ) = calculateClaimedAndFee(userAddress, extraClaimAmount);
  
        user.totalClaimed1 += claimedFromBatch1.toUint128();
        user.totalClaimed2 += claimedFromBatch2.toUint128();
        user.totalClaimedFromUnlocked += (claimedFromBatch1 + claimedFromBatch2).toUint128();
        user.totalClaimedFromLocked += claimedFromLocked.toUint128();
        user.totalClaimed += (claimedFromBatch1 + claimedFromBatch2 + claimedFromLocked).toUint128();
        user.totalFee += cappedFee.toUint128();
        user.totalBurned += burned.toUint128();
        
        totalFee += cappedFee.toUint128();
        totalBurned += burned.toUint128();
        totalClaimed += claimAmount.toUint128();

        vestingToken.safeTransfer(userAddress, claimAmount);
        vestingToken.safeTransfer(owner(), burned);  // this will change

        emit Claim(userAddress, claimAmount, cappedFee, baseClaimAmount, burned);
    }

    // =================== VIEW FUNCTIONS  =================== //

    function calculateClaimedAndFee(
        address userAddress, 
        uint128 extraClaimAmount
    ) public view returns (
        uint baseClaimAmount,
        uint claimAmount,
        uint claimedFromBatch1, 
        uint claimedFromBatch2, 
        uint claimedFromLocked,
        uint cappedFee,
        uint burned
     ) {
        User storage user = users[userAddress];
        uint unlocked = getUnlocked(userAddress);
        uint unlocked1 = getUnlocked1(userAddress);
        uint unlocked2 = getUnlocked2(userAddress);

        baseClaimAmount = unlocked1 + unlocked2;
        claimAmount = baseClaimAmount + extraClaimAmount;
        uint maxClaimableAmount = unlocked + getLocked(userAddress);

        require(claimAmount > 0, "nothing to claim");
        require(claimAmount <= maxClaimableAmount, "requested claim amount > max claimable");

        claimedFromBatch1 = unlocked1;
        claimedFromBatch2 = claimAmount - claimedFromBatch1;
        if (claimedFromBatch2 > unlocked - unlocked1) {
            claimedFromBatch2 = unlocked - unlocked1;
        }

        claimedFromLocked = claimAmount - claimedFromBatch1 - claimedFromBatch2;
        if (burnRate < HUNDRED_PERCENT) {
            burned = claimedFromLocked * burnRate / (HUNDRED_PERCENT - burnRate);
        }

        cappedFee = claimedFromBatch2;
        if (cappedFee > user.totalTokens - (user.totalFee + user.totalBurned + user.totalClaimed + claimAmount)) {
            cappedFee = user.totalTokens - (user.totalFee + user.totalBurned + user.totalClaimed + claimAmount);
        }
    }

    function getVestingSchedule(address userAddress, bool forBatch2) public view returns (uint vestingSchedule) {
        User storage user = users[userAddress];
        uint vestedTime = _getVestedTime(forBatch2);
        if (vestedTime == 0) {
            return 0;
        }
        
        uint firstUnlockTokens = _applyPercentage(user.totalTokens, firstUnlockPercentage);
        uint linearUnlocksTokens = user.totalTokens - firstUnlockTokens;
        uint linearUnlocksPassed = _getLinearUnlocksPassed(forBatch2);

        vestingSchedule = firstUnlockTokens + linearUnlocksTokens * linearUnlocksPassed / linearUnlocksCount;
        uint maxAllowed = user.totalTokens - user.totalClaimedFromLocked - user.totalBurned;
        if (vestingSchedule > maxAllowed) {
            vestingSchedule = maxAllowed;
        }

    }

    function getUnlocked(address userAddress) public view returns (uint) {
        User storage user = users[userAddress];
        uint vestingSchedule = getVestingSchedule(userAddress, false);
        if (user.eliminatedAt > 0) {
            vestingSchedule = user.totalTokens;
        }

        uint totalSpentWithoutBurn = user.totalClaimedFromUnlocked + user.totalFee;
        if (vestingSchedule > totalSpentWithoutBurn) {
            return vestingSchedule - totalSpentWithoutBurn;
        }
    }

    function getLocked(address userAddress) public view returns (uint) {
        User storage user = users[userAddress];
        uint vestedTime = _getVestedTime(false);
        if (vestedTime < lockedClaimableTokensOffset) {
            return 0;
        }
        
        uint totalSpent = user.totalClaimedFromUnlocked + user.totalFee + user.totalClaimedFromLocked + user.totalBurned;
        uint unlocked = getUnlocked(userAddress);
        uint unlocked1 = getUnlocked1(userAddress);
        uint unlocked2 = getUnlocked2(userAddress);

        if (user.totalTokens + unlocked1 + unlocked2 > totalSpent + unlocked * 2) {
            uint locked = user.totalTokens + unlocked1 + unlocked2 - (totalSpent + unlocked * 2);
            return _applyPercentage(locked, HUNDRED_PERCENT - burnRate);
        }
    }

    function getUnlocked1(address userAddress) public view returns (uint) {
        User storage user = users[userAddress];
        if (user.eliminatedAt > 0) {
            return _applyPercentage(getUnlocked(userAddress), batch1Percentage); 
        } 
            
        uint vestingSchedule = _applyPercentage(getVestingSchedule(userAddress, false), batch1Percentage);
        uint totalClaimed1AndFee = user.totalClaimed1 + _applyPercentage(user.totalFee, batch1Percentage);
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
        uint totalClaimed2AndFee = user.totalClaimed2 + _applyPercentage(user.totalFee, batch2Percentage);
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