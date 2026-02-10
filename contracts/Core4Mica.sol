// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MockERC20.sol";

/**
 * @title Core4Mica
 * @dev Credit clearing house for agent-to-agent financial interactions
 * Simplified implementation for demo purposes
 */
contract Core4Mica {
    // Collateral tracking per user per asset
    struct UserCollateral {
        uint256 total;
        uint256 locked;
        uint256 withdrawalRequestAmount;
        uint256 withdrawalRequestTimestamp;
    }

    // Payment tab between user and recipient
    struct Tab {
        uint256 tabId;
        address user;
        address recipient;
        address asset;
        uint256 startTimestamp;
        uint256 ttlSeconds;
        uint256 totalPaid;
        bool settled;
        bool active;
    }

    // Payment guarantee (BLS cert simplified to signature)
    struct Guarantee {
        uint256 tabId;
        uint256 reqId;
        address user;
        address recipient;
        address asset;
        uint256 amount;
        uint256 timestamp;
        bytes signature;
        bool claimed;
    }

    // State
    mapping(address => mapping(address => UserCollateral)) public collateral; // user => asset => collateral
    mapping(uint256 => Tab) public tabs;
    mapping(uint256 => mapping(uint256 => Guarantee)) public guarantees; // tabId => reqId => guarantee
    mapping(uint256 => uint256) public latestReqIds; // tabId => latest reqId with a guarantee

    uint256 public nextTabId = 1;
    uint256 public withdrawalDelay = 1 hours;
    uint256 public protocolFee = 5; // 0.05% (out of 10000)
    uint256 public constant FEE_DENOMINATOR = 10000;

    address public owner;
    uint256 public totalFeesCollected;

    // Supported assets
    mapping(address => bool) public supportedAssets;

    // Events
    event CollateralDeposited(address indexed user, address indexed asset, uint256 amount);
    event CollateralLocked(address indexed user, address indexed asset, uint256 amount);
    event CollateralUnlocked(address indexed user, address indexed asset, uint256 amount);
    event WithdrawalRequested(address indexed user, address indexed asset, uint256 amount, uint256 timestamp);
    event WithdrawalCancelled(address indexed user, address indexed asset);
    event WithdrawalFinalized(address indexed user, address indexed asset, uint256 amount);
    event TabCreated(uint256 indexed tabId, address indexed user, address indexed recipient, address asset);
    event TabSettled(uint256 indexed tabId, uint256 totalPaid);
    event GuaranteeIssued(uint256 indexed tabId, uint256 indexed reqId, uint256 amount);
    event GuaranteeClaimed(uint256 indexed tabId, uint256 indexed reqId, uint256 amount);
    event AssetSupported(address indexed asset);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @dev Add supported asset
     */
    function addSupportedAsset(address asset) external onlyOwner {
        supportedAssets[asset] = true;
        emit AssetSupported(asset);
    }

    /**
     * @dev Deposit collateral
     */
    function deposit(address asset, uint256 amount) external {
        require(supportedAssets[asset], "Asset not supported");
        require(amount > 0, "Amount must be > 0");

        MockERC20(asset).transferFrom(msg.sender, address(this), amount);
        collateral[msg.sender][asset].total += amount;

        emit CollateralDeposited(msg.sender, asset, amount);
    }

    /**
     * @dev Get user collateral info
     */
    function getUserCollateral(address user, address asset) external view returns (
        uint256 total,
        uint256 locked,
        uint256 available,
        uint256 withdrawalRequestAmount,
        uint256 withdrawalRequestTimestamp
    ) {
        UserCollateral storage c = collateral[user][asset];
        return (
            c.total,
            c.locked,
            c.total - c.locked,
            c.withdrawalRequestAmount,
            c.withdrawalRequestTimestamp
        );
    }

    /**
     * @dev Request withdrawal (starts timelock)
     */
    function requestWithdrawal(address asset, uint256 amount) external {
        UserCollateral storage c = collateral[msg.sender][asset];
        require(c.total - c.locked >= amount, "Insufficient available collateral");

        c.withdrawalRequestAmount = amount;
        c.withdrawalRequestTimestamp = block.timestamp;

        emit WithdrawalRequested(msg.sender, asset, amount, block.timestamp);
    }

    /**
     * @dev Cancel withdrawal request
     */
    function cancelWithdrawal(address asset) external {
        UserCollateral storage c = collateral[msg.sender][asset];
        c.withdrawalRequestAmount = 0;
        c.withdrawalRequestTimestamp = 0;

        emit WithdrawalCancelled(msg.sender, asset);
    }

    /**
     * @dev Finalize withdrawal after timelock
     */
    function finalizeWithdrawal(address asset) external {
        UserCollateral storage c = collateral[msg.sender][asset];
        require(c.withdrawalRequestAmount > 0, "No withdrawal request");
        require(block.timestamp >= c.withdrawalRequestTimestamp + withdrawalDelay, "Timelock not expired");

        uint256 amount = c.withdrawalRequestAmount;
        require(c.total - c.locked >= amount, "Insufficient available collateral");

        c.total -= amount;
        c.withdrawalRequestAmount = 0;
        c.withdrawalRequestTimestamp = 0;

        MockERC20(asset).transfer(msg.sender, amount);

        emit WithdrawalFinalized(msg.sender, asset, amount);
    }

    /**
     * @dev Create a payment tab
     */
    function createTab(address user, address recipient, address asset, uint256 ttlSeconds) external returns (uint256 tabId) {
        require(supportedAssets[asset], "Asset not supported");

        tabId = nextTabId++;

        tabs[tabId] = Tab({
            tabId: tabId,
            user: user,
            recipient: recipient,
            asset: asset,
            startTimestamp: block.timestamp,
            ttlSeconds: ttlSeconds,
            totalPaid: 0,
            settled: false,
            active: true
        });

        emit TabCreated(tabId, user, recipient, asset);
    }

    /**
     * @dev Issue payment guarantee (lock collateral)
     * In real 4Mica, this uses BLS signatures for aggregation
     */
    function issueGuarantee(
        uint256 tabId,
        uint256 reqId,
        uint256 amount,
        bytes calldata signature
    ) external {
        Tab storage tab = tabs[tabId];
        require(tab.active, "Tab not active");
        require(!tab.settled, "Tab already settled");
        require(block.timestamp <= tab.startTimestamp + tab.ttlSeconds, "Tab expired");

        UserCollateral storage c = collateral[tab.user][tab.asset];
        require(c.total - c.locked >= amount, "Insufficient collateral");

        // Lock collateral
        c.locked += amount;

        // Store guarantee
        guarantees[tabId][reqId] = Guarantee({
            tabId: tabId,
            reqId: reqId,
            user: tab.user,
            recipient: tab.recipient,
            asset: tab.asset,
            amount: amount,
            timestamp: block.timestamp,
            signature: signature,
            claimed: false
        });

        // Track latest reqId for this tab
        if (reqId >= latestReqIds[tabId]) {
            latestReqIds[tabId] = reqId;
        }

        emit CollateralLocked(tab.user, tab.asset, amount);
        emit GuaranteeIssued(tabId, reqId, amount);
    }

    /**
     * @dev Claim guarantee (recipient claims payment)
     */
    function claimGuarantee(uint256 tabId, uint256 reqId) external {
        Guarantee storage g = guarantees[tabId][reqId];
        require(g.amount > 0, "Guarantee not found");
        require(!g.claimed, "Already claimed");
        require(msg.sender == g.recipient, "Not recipient");

        Tab storage tab = tabs[tabId];
        UserCollateral storage c = collateral[g.user][g.asset];

        // Calculate fee
        uint256 fee = (g.amount * protocolFee) / FEE_DENOMINATOR;
        uint256 netAmount = g.amount - fee;

        // Update state
        g.claimed = true;
        c.locked -= g.amount;
        c.total -= g.amount;
        tab.totalPaid += g.amount;
        totalFeesCollected += fee;

        // Transfer to recipient
        MockERC20(g.asset).transfer(g.recipient, netAmount);

        emit CollateralUnlocked(g.user, g.asset, g.amount);
        emit GuaranteeClaimed(tabId, reqId, netAmount);
    }

    /**
     * @dev Pay tab with ERC20 token (happy path)
     * Called by the trader (tab.user) to pay the recipient directly.
     * This releases the locked collateral for the specified guarantee.
     * Matches the real 4Mica SDK's UserClient.payTab() signature.
     */
    function payTabInERC20Token(
        uint256 tabId,
        uint256 reqId,
        uint256 amount,
        address recipient,
        address token
    ) external {
        Tab storage tab = tabs[tabId];
        require(tab.active, "Tab not active");
        require(!tab.settled, "Tab already settled");
        require(msg.sender == tab.user, "Not tab user");
        require(recipient == tab.recipient, "Recipient mismatch");
        require(token == tab.asset, "Token mismatch");

        Guarantee storage g = guarantees[tabId][reqId];
        require(g.amount > 0, "Guarantee not found");
        require(!g.claimed, "Already claimed");

        // Transfer tokens from trader to recipient
        MockERC20(token).transferFrom(msg.sender, recipient, amount);

        // Release locked collateral (guarantee is satisfied by direct payment)
        UserCollateral storage c = collateral[tab.user][tab.asset];
        g.claimed = true;
        c.locked -= g.amount;
        tab.totalPaid += amount;

        emit CollateralUnlocked(tab.user, tab.asset, g.amount);
        emit GuaranteeClaimed(tabId, reqId, amount);
    }

    /**
     * @dev Remunerate (unhappy path) - Recipient seizes locked collateral
     * Called by the solver/recipient when trader fails to pay.
     * Equivalent to claimGuarantee but named to match SDK's RecipientClient.remunerate().
     */
    function remunerate(uint256 tabId, uint256 reqId) external {
        Guarantee storage g = guarantees[tabId][reqId];
        require(g.amount > 0, "Guarantee not found");
        require(!g.claimed, "Already claimed");
        require(msg.sender == g.recipient, "Not recipient");

        Tab storage tab = tabs[tabId];
        UserCollateral storage c = collateral[g.user][g.asset];

        // Calculate fee
        uint256 fee = (g.amount * protocolFee) / FEE_DENOMINATOR;
        uint256 netAmount = g.amount - fee;

        // Update state
        g.claimed = true;
        c.locked -= g.amount;
        c.total -= g.amount;
        tab.totalPaid += g.amount;
        totalFeesCollected += fee;

        // Transfer collateral to recipient
        MockERC20(g.asset).transfer(g.recipient, netAmount);

        emit CollateralUnlocked(g.user, g.asset, g.amount);
        emit GuaranteeClaimed(tabId, reqId, netAmount);
    }

    /**
     * @dev Get latest reqId for a tab (view function for mock SDK)
     */
    function getLatestReqId(uint256 tabId) external view returns (uint256) {
        return latestReqIds[tabId];
    }

    /**
     * @dev Settle tab (close it out)
     */
    function settleTab(uint256 tabId) external {
        Tab storage tab = tabs[tabId];
        require(tab.active, "Tab not active");
        require(msg.sender == tab.user || msg.sender == tab.recipient || msg.sender == owner, "Not authorized");

        tab.settled = true;
        tab.active = false;

        emit TabSettled(tabId, tab.totalPaid);
    }

    /**
     * @dev Auto-settle expired tab with penalty (unhappy path)
     */
    function autoSettle(uint256 tabId) external {
        Tab storage tab = tabs[tabId];
        require(tab.active, "Tab not active");
        require(block.timestamp > tab.startTimestamp + tab.ttlSeconds, "Tab not expired");

        // In unhappy path, penalize the user
        UserCollateral storage c = collateral[tab.user][tab.asset];

        // Forfeit 10% of locked collateral as penalty
        uint256 penalty = c.locked / 10;
        if (penalty > 0) {
            c.locked -= penalty;
            c.total -= penalty;
            totalFeesCollected += penalty;
        }

        // Release remaining locked collateral
        c.locked = 0;

        tab.settled = true;
        tab.active = false;

        emit TabSettled(tabId, tab.totalPaid);
    }

    /**
     * @dev Get tab info
     */
    function getTab(uint256 tabId) external view returns (Tab memory) {
        return tabs[tabId];
    }

    /**
     * @dev Get guarantee info
     */
    function getGuarantee(uint256 tabId, uint256 reqId) external view returns (Guarantee memory) {
        return guarantees[tabId][reqId];
    }

    /**
     * @dev Set protocol fee (owner only)
     */
    function setProtocolFee(uint256 newFee) external onlyOwner {
        require(newFee <= 100, "Fee too high"); // Max 1%
        protocolFee = newFee;
    }

    /**
     * @dev Set withdrawal delay (owner only)
     */
    function setWithdrawalDelay(uint256 newDelay) external onlyOwner {
        withdrawalDelay = newDelay;
    }

    /**
     * @dev Withdraw collected fees (owner only)
     */
    function withdrawFees(address asset, uint256 amount) external onlyOwner {
        require(amount <= totalFeesCollected, "Insufficient fees");
        totalFeesCollected -= amount;
        MockERC20(asset).transfer(owner, amount);
    }
}
