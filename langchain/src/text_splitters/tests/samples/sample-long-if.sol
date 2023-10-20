function accrueConcentratedPositionTimeWeightedLiquidity(
    address payable owner,
    bytes32 poolIdx,
    int24 lowerTick,
    int24 upperTick
) internal {
    RangePosition72 storage pos = lookupPosition(
        owner,
        poolIdx,
        lowerTick,
        upperTick
    );
    bytes32 posKey = encodePosKey(owner, poolIdx, lowerTick, upperTick);
    uint32 lastAccrued = timeWeightedWeeklyPositionConcLiquidityLastSet_[
        poolIdx
    ][posKey];
    // Only set time on first call
    if (lastAccrued != 0) {
        uint256 liquidity = pos.liquidity_;
        for (int24 i = lowerTick + 10; i <= upperTick - 10; ++i) {
            uint32 tickTrackingIndex = tickTrackingIndexAccruedUpTo_[poolIdx][posKey][i];
            uint32 origIndex = tickTrackingIndex;
            uint32 numTickTracking = uint32(tickTracking_[poolIdx][i].length);
            uint32 time = lastAccrued;
            // Loop through all in-range time spans for the tick or up to the current time (if it is still in range)
            while (time < block.timestamp && tickTrackingIndex < numTickTracking) {
                TickTracking memory tickTracking = tickTracking_[poolIdx][i][tickTrackingIndex];
                uint32 currWeek = uint32((time / WEEK) * WEEK);
                uint32 nextWeek = uint32(((time + WEEK) / WEEK) * WEEK);
                uint32 dt = uint32(
                    nextWeek < block.timestamp
                        ? nextWeek - time
                        : block.timestamp - time
                );
                uint32 tickActiveStart; // Timestamp to use for the liquidity addition
                uint32 tickActiveEnd;
                if (tickTracking.enterTimestamp < nextWeek) {
                    // Tick was active before next week, need to add the liquidity
                    if (tickTracking.enterTimestamp < time) {
                        // Tick was already active when last claim happened, only accrue from last claim timestamp
                        tickActiveStart = time;
                    } else {
                        // Tick has become active this week
                        tickActiveStart = tickTracking.enterTimestamp;
                    }
                    if (tickTracking.exitTimestamp == 0) {
                        // Tick still active, do not increase index because we need to continue from here
                        tickActiveEnd = uint32(nextWeek < block.timestamp ? nextWeek : block.timestamp);
                    } else {
                        // Tick is no longer active
                        if (tickTracking.exitTimestamp < nextWeek) {
                            // Exit was in this week, continue with next tick
                            tickActiveEnd = tickTracking.exitTimestamp;
                            tickTrackingIndex++;
                            dt = tickActiveEnd - tickActiveStart;
                        } else {
                            // Exit was in next week, we need to consider the current tick there (i.e. not increase the index)
                            tickActiveEnd = nextWeek;
                        }
                    }
                    timeWeightedWeeklyPositionInRangeConcLiquidity_[poolIdx][posKey][currWeek][i] +=
                        (tickActiveEnd - tickActiveStart) * liquidity;
                }
                time += dt;
            }
            if (tickTrackingIndex != origIndex) {
                tickTrackingIndexAccruedUpTo_[poolIdx][posKey][i] = tickTrackingIndex;
            }
        }
    } else {
        for (int24 i = lowerTick + 10; i <= upperTick - 10; ++i) {
            uint32 numTickTracking = uint32(tickTracking_[poolIdx][i].length);
            if (numTickTracking > 0) {
                if (tickTracking_[poolIdx][i][numTickTracking - 1].exitTimestamp == 0) {
                    // Tick currently active
                    tickTrackingIndexAccruedUpTo_[poolIdx][posKey][i] = numTickTracking - 1;
                } else {
                    tickTrackingIndexAccruedUpTo_[poolIdx][posKey][i] = numTickTracking;
                }
            }
        }
    }
    timeWeightedWeeklyPositionConcLiquidityLastSet_[poolIdx][
        posKey
    ] = uint32(block.timestamp);
}
