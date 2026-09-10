# ChronoShift

A local-first desktop time tracker. It runs in the system tray, periodically asks what you are working on, and lets you correct your week afterwards. It records what you tell it — it does not watch what you do.

## Language

### The timeline

**Segment**:
A contiguous stretch of time attributed to exactly one bucket. Segments never overlap.
_Avoid_: entry, block, interval, session, event

**Open segment**:
The single segment with no end time — the time being tracked right now. There is never more than one.
_Avoid_: active segment, current entry, running timer

**Gap**:
Untracked time: a stretch with no segment covering it. A gap is a legitimate outcome, not missing data.
_Avoid_: unassigned time, empty time, idle time

**Backdate**:
Giving a state change an effective time earlier than now, so that "I switched at 09:40" records the switch at 09:40 rather than when you said so.
_Avoid_: retroactive edit, since-when, rewind

### Attribution

**Bucket**:
A thing you book time to, arranged in a nested tree. Any bucket is bookable, including one that has children.
_Avoid_: project, task, category, activity, code, tag

**Break**:
A reserved bucket representing non-work time. Break is a bucket, not a state and not the absence of one, so break time sits on the timeline like any other segment.
_Avoid_: pause, away state, null bucket, downtime

**Recents**:
The buckets used most recently, offered as shortcuts. Derived from the timeline rather than remembered separately.
_Avoid_: favourites, pinned buckets, history

### Confirmation

**Confirmation watermark**:
The point within a segment up to which you have affirmatively said you were on that bucket. It is a position in time, not a yes/no.
_Avoid_: confirmed flag, verified, approved, validated

**Confirmed**:
Time at or before the watermark. You said so.
_Avoid_: verified, approved, locked

**Presumed**:
Time after the watermark. The app believes it based on the last thing it was told, but nobody has vouched for it. Presumed time is always shown as such rather than passed off as fact.
_Avoid_: unconfirmed, unverified, assumed, guessed, provisional

**Needs review**:
The set of segments whose confirmation is incomplete — the queue of things worth a second look.
_Avoid_: pending, unresolved, inbox

### Being asked

**Check-in**:
The periodic prompt asking whether you are still on the same bucket. Answering one moves the watermark.
_Avoid_: reminder, nag, ping, poll, notification

**Idle event**:
A recorded stretch during which you were away from the machine — through inactivity, a locked screen, or a suspended machine. An idle event is a question to be resolved, not a verdict about what the time was.
_Avoid_: away time, absence, inactivity gap, AFK

**Recovery**:
Reconciling the timeline after the app stopped running without being told to — a crash, a hard sleep, a lost power cable.
_Avoid_: crash handling, cleanup, repair

### Naming

The application is **ChronoShift**. Earlier drafts called it "Bucket Tracker"; that name is retired and should not appear in code, menus, or documents.
