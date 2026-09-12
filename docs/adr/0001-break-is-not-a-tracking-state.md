# Break is not a tracking state

BUILD_PLAN §5.3 says break is a reserved system bucket, "not a separate state or a null bucket," so the timeline stays one code path. §8.2 then asks the tray to reflect "three states: idle (not tracking), tracking, on break," which read literally would make break a third state of the tracking machine. We're resolving that in favor of §5.3: the tracking state machine (`app/src/services/tracking.ts`) has exactly two states, `not_tracking` and `tracking`. "On break" is the tray deriving a display concern from the open segment's bucket (`kind='break'`) — it never appears as a branch in the machine's own transition logic. §8.2's "three states" is tray-icon vocabulary, not machine vocabulary.

## Consequences

Any code that needs to know "is the user on break" queries the open segment's bucket, not the tracking state — there is no `on_break` value to switch on. If a future feature needs break to behave differently from other tracking (e.g. a different check-in cadence), that's a new orthogonal flag alongside `idleUnresolved`, following the same pattern, not a new state.
