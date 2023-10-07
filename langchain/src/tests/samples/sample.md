*Submitted by [MiloTruck](https://github.com/code-423n4/2023-03-polynomial-findings/issues/146), also found by [joestakey](https://github.com/code-423n4/2023-03-polynomial-findings/issues/174) and [Nyx](https://github.com/code-423n4/2023-03-polynomial-findings/issues/102)*

Frontends or contracts that rely on `canLiquidate()` to determine if a position is liquidatable could be incorrect. Users could think their positions are safe from liquidation even though they are liquidatable, leading to them losing their collateral.

### Vulnerability Details

In the `ShortCollateral` contract, `canLiquidate()` determines if a short position can be liquidated using the following formula:

```solidity
uint256 minCollateral = markPrice.mulDivUp(position.shortAmount, collateralPrice);
minCollateral = minCollateral.mulWadDown(collateral.liqRatio);

return position.collateralAmount < minCollateral;
```

Where:

*   `position.collateralAmount` - Amount of collateral in the short position.
*   `minCollateral` - Minimum amount of collateral required to avoid liquidation.

From the above, a short position can be liquidated if its collateral amount is **less than** `minCollateral`. This means a short position with the minimum collateral amount (ie. `position.collateralAmount == minCollateral`)  cannot be liquidated.

However, this is not the case in `maxLiquidatableDebt()`, which is used to determine a position's maximum liquidatable debt:


```solidity
uint256 safetyRatioNumerator = position.collateralAmount.mulWadDown(collateralPrice);
uint256 safetyRatioDenominator = position.shortAmount.mulWadDown(markPrice);
safetyRatioDenominator = safetyRatioDenominator.mulWadDown(collateral.liqRatio);
uint256 safetyRatio = safetyRatioNumerator.divWadDown(safetyRatioDenominator);

if (safetyRatio > 1e18) return maxDebt;

maxDebt = position.shortAmount / 2;
```

Where:

*   `safetyRatio` - Equivalent to `position.collateralAmount / minCollateral`. Can be seen as a position's collateral amount against the minimum collateral required.
*   `maxDebt` - The amount of debt liquidatable. Defined as 0 at the start of the function.

As seen from the `safetyRatio > 1e18` check, a position is safe from liquidation (ie. `maxDebt = 0`) if  its `safetyRatio` is **greater than** 1.

Therefore, as a position with the minimum collateral amount has a `safetyRatio` of 1, half its debt becomes liquidatable. This contradicts `canLiquidate()`, which returns `false` for such positions.

### Proof of Concept

The following test demonstrates how a position with minimum collateral is liquidatable even though `canLiquidate()` returns `false`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {TestSystem, Exchange, ShortToken, ShortCollateral, PowerPerp, MockERC20Fail} from "./utils/TestSystem.sol";

contract CanLiquidateIsInaccurate is TestSystem {
    // Protocol contracts
    Exchange private exchange;
    ShortToken private shortToken;
    ShortCollateral private shortCollateral;
    
    // sUSD token contract
    MockERC20Fail private SUSD;
    
    function setUp() public {  
        // Set liquidation ratio of sUSD to 125%  
        susdLiqRatio = 1.24e18;

        // Deploy contracts
        deployTestSystem();
        initPool();
        initExchange();
        preparePool();

        exchange = getExchange();
        shortToken = getShortToken();
        shortCollateral = getShortCollateral();
        SUSD = getSUSD();

        // Mint sUSD for user_1
        SUSD.mint(user_1, 1e20);

        // Mint powerPerp for user_2
        vm.prank(address(exchange));
        getPowerPerp().mint(user_2, 1e20);
    }

    function testCanLiquidateMightBeWrong() public {
        // Initial price of base asset is 1e18
        uint256 initialPrice = 1e18;
        setAssetPrice(initialPrice);

        // Open short position with 1e15 sUSD as collateral
        Exchange.TradeParams memory tradeParams;
        tradeParams.amount = 1e18;
        tradeParams.collateral = address(SUSD);
        tradeParams.collateralAmount = 1e15;
        tradeParams.minCost = 0;

        vm.startPrank(user_1);
        SUSD.approve(address(exchange), tradeParams.collateralAmount);
        (uint256 positionId,) = exchange.openTrade(tradeParams);
        vm.stopPrank();
       
        // Initial price of base asset increases, such that minCollateral == collateralAmount
        setAssetPrice(1270001270001905664);

        // canLiquidate() returns false
        assertFalse(shortCollateral.canLiquidate(positionId));

        // However, maxLiquidatableDebt() returns half of original amount
        assertEq(shortCollateral.maxLiquidatableDebt(positionId), tradeParams.amount / 2);

        // Other users can liquidate the short position
        vm.prank(user_2);
        exchange.liquidate(positionId, tradeParams.amount);

        // Position's shortAmount and collateral is reduced
        (, uint256 remainingAmount, uint256 remainingCollateralAmount, ) = shortToken.shortPositions(positionId);
        assertEq(remainingAmount, tradeParams.amount / 2);
        assertLt(remainingCollateralAmount, tradeParams.collateralAmount);
    }
}
```

### Recommended Mitigation

Consider making short positions safe from liquidation if their `safetyRatio` equals to 1:

`ShortCollateral.sol#L235`:

```diff
-        if (safetyRatio > 1e18) return maxDebt;
+        if (safetyRatio >= 1e18) return maxDebt;
```


