recursive splitter
- splits on separators from top to bottom
- if split fills the chunk size, it chooses the next separator until it doesn't fill the chunk
- if the chunk is too small, it will merge the chunks
- option to not count whitespace in front of / end of lines
- adds overlap from the previous chunk after getting initial chunks


# recursive logic
// maybe should start from the last separator? then can increase the size
  
- first solution. just try to split and in the end get chunks that fit to the chunk size
if any chunk fits, then just add




1. there is a max length of chunk (chunkSize)
2. there are separators (function, pragma ~\n~ \n\n)
4. split text according to these separators (separatorChunks)
5. from separatorChunks create chunks (chunkSize chunks)
6. add overlap from previous 

if chunk size > chunkSize, then remove lines from the end and split those lines again

important is to see the result that separates functions and if the function body is too long, then it splits that one into chunks as well



// SPDX-License-Identifier: GPL-3

pragma solidity 0.8.19;

import "../libraries/SafeCast.sol";
import "./PositionRegistrar.sol";
import "./StorageLayout.sol";
import "./PoolRegistry.sol";

/* @title Liquidity mining mixin
 * @notice Contains the functions related to liquidity mining claiming. */
contract LiquidityMining is PositionRegistrar {
    uint256 constant WEEK = 604800; // Week in seconds 604800

    /// @notice Initialize the tick tracking for the first tick of a pool
    function initTickTracking(bytes32 poolIdx, int24 tick) internal {
        StorageLayout.TickTracking memory tickTrackingData = StorageLayout
            .TickTracking(uint32(block.timestamp), 0);
        tickTracking_[poolIdx][tick].push(tickTrackingData);
    }

    /// @notice Keeps track of the tick crossings
    /// @dev Needs to be called whenever a tick is crossed
    function crossTicks(
        bytes32 poolIdx,
        int24 exitTick,
        int24 entryTick
    ) internal {
        uint256 numElementsExit = tickTracking_[poolIdx][exitTick].length;
        tickTracking_[poolIdx][exitTick][numElementsExit - 1]
            .exitTimestamp = uint32(block.timestamp);
        StorageLayout.TickTracking memory tickTrackingData = StorageLayout
            .TickTracking(uint32(block.timestamp), 0);
        tickTracking_[poolIdx][entryTick].push(tickTrackingData);
    }

    /// @notice Keeps track of the global in-range time-weighted concentrated liquidity per week
    /// @dev Needs to be called whenever the concentrated liquidity is modified (tick crossed, positions changed)
    function accrueConcentratedGlobalTimeWeightedLiquidity(
        bytes32 poolIdx,
        CurveMath.CurveState memory curve
    ) internal {
        uint32 lastAccrued = timeWeightedWeeklyGlobalConcLiquidityLastSet_[
            poolIdx
        ];
        // Only set time on first call
        if (lastAccrued != 0) {
            uint256 liquidity = curve.concLiq_;
            uint32 time = lastAccrued;
            while (time < block.timestamp) {
                uint32 currWeek = uint32((time / WEEK) * WEEK);
                uint32 nextWeek = uint32(((time + WEEK) / WEEK) * WEEK);
                uint32 dt = uint32(
                    nextWeek < block.timestamp
                        ? nextWeek - time
                        : block.timestamp - time
                );
                timeWeightedWeeklyGlobalConcLiquidity_[poolIdx][currWeek] += dt * liquidity;
                time += dt;
            }
        }
        timeWeightedWeeklyGlobalConcLiquidityLastSet_[poolIdx] = uint32(
            block.timestamp
        );
    }
}