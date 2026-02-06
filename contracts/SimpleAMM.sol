// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MockERC20.sol";

/**
 * @title SimpleAMM
 * @dev Constant-product AMM for USDC/USDT pairs
 * x * y = k formula with configurable fee
 */
contract SimpleAMM {
    MockERC20 public immutable tokenA; // USDC
    MockERC20 public immutable tokenB; // USDT

    uint256 public reserveA;
    uint256 public reserveB;

    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public fee = 30; // 0.3% fee

    address public owner;

    // LP token tracking (simplified)
    uint256 public totalLiquidity;
    mapping(address => uint256) public liquidity;

    event Swap(address indexed trader, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);
    event AddLiquidity(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event RemoveLiquidity(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event PriceManipulated(uint256 newReserveA, uint256 newReserveB);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _tokenA, address _tokenB) {
        tokenA = MockERC20(_tokenA);
        tokenB = MockERC20(_tokenB);
        owner = msg.sender;
    }

    /**
     * @dev Get current price of tokenA in terms of tokenB
     */
    function getPrice() external view returns (uint256) {
        if (reserveA == 0) return 1e6; // 1:1 default
        return (reserveB * 1e6) / reserveA;
    }

    /**
     * @dev Get the spread between this AMM and a reference price
     */
    function getSpread(uint256 referencePrice) external view returns (int256) {
        if (reserveA == 0) return 0;
        uint256 currentPrice = (reserveB * 1e6) / reserveA;
        return int256(currentPrice) - int256(referencePrice);
    }

    /**
     * @dev Calculate output amount for a given input
     */
    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256 amountOut) {
        require(amountIn > 0, "Insufficient input");
        require(reserveA > 0 && reserveB > 0, "No liquidity");

        bool isTokenA = tokenIn == address(tokenA);
        uint256 reserveIn = isTokenA ? reserveA : reserveB;
        uint256 reserveOut = isTokenA ? reserveB : reserveA;

        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - fee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * FEE_DENOMINATOR) + amountInWithFee;

        amountOut = numerator / denominator;
    }

    /**
     * @dev Swap tokens
     */
    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut) {
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");

        amountOut = getAmountOut(tokenIn, amountIn);
        require(amountOut >= minAmountOut, "Slippage exceeded");

        bool isTokenA = tokenIn == address(tokenA);

        if (isTokenA) {
            tokenA.transferFrom(msg.sender, address(this), amountIn);
            tokenB.transfer(msg.sender, amountOut);
            reserveA += amountIn;
            reserveB -= amountOut;
            emit Swap(msg.sender, address(tokenA), amountIn, address(tokenB), amountOut);
        } else {
            tokenB.transferFrom(msg.sender, address(this), amountIn);
            tokenA.transfer(msg.sender, amountOut);
            reserveB += amountIn;
            reserveA -= amountOut;
            emit Swap(msg.sender, address(tokenB), amountIn, address(tokenA), amountOut);
        }
    }

    /**
     * @dev Add liquidity to the pool
     */
    function addLiquidity(uint256 amountA, uint256 amountB) external returns (uint256 liquidityMinted) {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        if (totalLiquidity == 0) {
            liquidityMinted = sqrt(amountA * amountB);
        } else {
            liquidityMinted = min(
                (amountA * totalLiquidity) / reserveA,
                (amountB * totalLiquidity) / reserveB
            );
        }

        require(liquidityMinted > 0, "Insufficient liquidity minted");

        liquidity[msg.sender] += liquidityMinted;
        totalLiquidity += liquidityMinted;
        reserveA += amountA;
        reserveB += amountB;

        emit AddLiquidity(msg.sender, amountA, amountB, liquidityMinted);
    }

    /**
     * @dev Remove liquidity from the pool
     */
    function removeLiquidity(uint256 liquidityAmount) external returns (uint256 amountA, uint256 amountB) {
        require(liquidity[msg.sender] >= liquidityAmount, "Insufficient liquidity");

        amountA = (liquidityAmount * reserveA) / totalLiquidity;
        amountB = (liquidityAmount * reserveB) / totalLiquidity;

        liquidity[msg.sender] -= liquidityAmount;
        totalLiquidity -= liquidityAmount;
        reserveA -= amountA;
        reserveB -= amountB;

        tokenA.transfer(msg.sender, amountA);
        tokenB.transfer(msg.sender, amountB);

        emit RemoveLiquidity(msg.sender, amountA, amountB, liquidityAmount);
    }

    /**
     * @dev DEMO ONLY: Manipulate reserves to create arbitrage opportunities
     * This would never exist in a real AMM
     */
    function manipulatePrice(uint256 newReserveA, uint256 newReserveB) external onlyOwner {
        // Mint/burn tokens as needed to match new reserves
        if (newReserveA > reserveA) {
            tokenA.mint(address(this), newReserveA - reserveA);
        }
        if (newReserveB > reserveB) {
            tokenB.mint(address(this), newReserveB - reserveB);
        }

        reserveA = newReserveA;
        reserveB = newReserveB;

        emit PriceManipulated(newReserveA, newReserveB);
    }

    /**
     * @dev Set fee (owner only)
     */
    function setFee(uint256 newFee) external onlyOwner {
        require(newFee <= 1000, "Fee too high"); // Max 10%
        fee = newFee;
    }

    // Math helpers
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
