import { useEffect, useRef, useState, type RefObject } from "react";
import {
  SPRING_BACK,
  SPRING_OUT,
  SWIPE_SLOP_PX,
  shouldCommitSwipe,
  springAtRest,
  stepSpring,
  swipeOffset,
  swipeThreshold,
  type SwipeActionView,
} from "@/lib/swipe";

/** Which way the finger travels: "right" reveals the underlay on the left. */
export type SwipeSide = "left" | "right";

/** What the underlay shows. Latched when the swipe starts, so a committed
 *  toggle keeps its label while the row springs home. */
export interface SwipeReveal {
  side: SwipeSide;
  action: SwipeActionView | null;
}

/** How long a removed row takes to fold. Written to the row as
 *  --spooler-swipe-fold, which app.css reads, so the wait and the transition
 *  cannot drift apart. */
const FOLD_MS = 220;
/** A removed row that is still here after this was kept (confirm cancelled). */
const RESTORE_MS = 1200;
/** Only the last stretch of movement decides a flick. */
const VELOCITY_WINDOW_MS = 90;
/**
 * Trackpads send no lift-off, so silence is all there is. Lifting after a
 * swipe leaves a momentum tail that fades out; holding still just stops. So
 * a faded-out stream releases almost at once, while an abrupt stop holds the
 * row under the resting fingers and only decides after a longer pause.
 */
const WHEEL_LIFT_MS = 90;
const WHEEL_HOLD_MS = 650;
/** Quiet time that ends the momentum tail after a release. */
const WHEEL_COOLDOWN_MS = 140;
/**
 * Short of arming, an abrupt stop has nothing to decide: after this brief
 * rest the row settles open with its action as a button (Mail on a Mac), so
 * resting fingers never force a choice. Moving again carries on.
 */
const WHEEL_REST_MS = 260;
/**
 * A trackpad eases into a swipe in small steps; a mouse wheel, tilted or
 * pushed sideways with Shift, steps a whole notch (about 100px) at once. A
 * first sideways step this big is a mouse and is left to scroll the list.
 */
const WHEEL_NOTCH_PX = 40;
/** How far an open row sits aside, and the least pull that opens it. */
const OPEN_PX = 96;
const OPEN_MIN_PX = 32;

/** Only one row stays open at a time: opening another closes this. */
let closeOpenRow: (() => void) | null = null;

/** True when recent sideways deltas look like a momentum tail dying out:
 *  a run of shrinking steps from a real flick down to almost nothing. */
export function looksLikeMomentumEnd(recent: number[]): boolean {
  if (recent.length < 5) return false;
  const run = recent.slice(-5);
  const last = run[run.length - 1];
  if (last > 1.5 || run[0] < 3) return false;
  for (let i = 1; i < run.length; i += 1) {
    if (run[i] > run[i - 1] * 1.05) return false;
  }
  return true;
}

type Phase = "drag" | "settle" | "open" | "out" | "fold" | "gone";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Touch and trackpad swipe on a thread row. Movement is written straight to
 * the row's style, and release runs a spring on animation frames that starts
 * at the input's speed, so nothing waits on React and a flick flows into the
 * settle. Mouse clicks and drags never start a swipe, so they keep drag to
 * section and the hover actions.
 */
export function useRowSwipe({
  rowRef,
  enabled,
  right,
  left,
  restoreKey,
  onStart,
  onCommit,
}: {
  rowRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  /** Action for a rightward swipe, or null for none. */
  right: SwipeActionView | null;
  left: SwipeActionView | null;
  /** Changes when the thread's state does; brings back a row that was
   *  swiped away but stayed listed (for example, archived while shown). */
  restoreKey: string;
  /** A swipe began; the row closes anything anchored to it. */
  onStart?: () => void;
  /** `offset` is how far the row is drawn from rest (px, signed) when the
   *  action runs, for anything anchored to where the row sits. */
  onCommit: (action: SwipeActionView, offset: number) => void;
}): SwipeReveal | null {
  const [reveal, setRevealState] = useState<SwipeReveal | null>(null);
  // Teardown runs on every row whenever swiping toggles (selection mode, say).
  // Skipping the no-op null spares each row a second, wasted render.
  const revealRef = useRef<SwipeReveal | null>(null);
  const setReveal = (next: SwipeReveal | null) => {
    if (next === null && revealRef.current === null) return;
    revealRef.current = next;
    setRevealState(next);
  };
  const latest = useRef({ right, left, onStart, onCommit });
  latest.current = { right, left, onStart, onCommit };
  const phaseRef = useRef<Phase | null>(null);
  const restoreRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || !enabled) return;

    let tracking = false;
    let locked = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let width = 0;
    let threshold = 64;
    /** Where the row is drawn now, and which side's pill is showing. */
    let x = 0;
    let side: SwipeSide | null = null;
    let action: SwipeActionView | null = null;
    let armed = false;
    let samples: { x: number; t: number }[] = [];
    let suppressClickUntil = 0;
    let frame: number | null = null;
    let timer: number | null = null;
    /** A removing action the user has committed to but not yet delivered:
     *  the row is still sliding out and folding. */
    let pending: SwipeActionView | null = null;

    const deliver = () => {
      const committed = pending;
      pending = null;
      if (committed) latest.current.onCommit(committed, x);
    };

    const setPhase = (phase: Phase | null) => {
      phaseRef.current = phase;
      if (phase) row.dataset.swipePhase = phase;
      else delete row.dataset.swipePhase;
    };

    const setArmed = (next: boolean) => {
      if (next === armed) return;
      armed = next;
      if (armed) row.dataset.swipeArmed = "";
      else delete row.dataset.swipeArmed;
    };

    /** The pill fills exactly the gap the row leaves on the revealed side. */
    const paint = (next: number) => {
      x = next;
      row.style.transform = x === 0 ? "" : `translate3d(${x}px, 0, 0)`;
      const sign = side === "right" ? 1 : side === "left" ? -1 : 0;
      const gap = action ? Math.max(0, x * sign) : 0;
      row.style.setProperty("--spooler-swipe-w", `${gap}px`);
      row.style.setProperty(
        "--spooler-swipe-p",
        `${Math.min(1, gap / threshold).toFixed(3)}`,
      );
    };

    const stopMotion = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      frame = null;
      timer = null;
    };

    const reset = () => {
      listenWhileOpen(false);
      if (closeOpenRow === closeThis) closeOpenRow = null;
      stopMotion();
      setPhase(null);
      side = null;
      action = null;
      paint(0);
      row.style.removeProperty("--spooler-swipe-w");
      row.style.removeProperty("--spooler-swipe-p");
      row.style.removeProperty("--spooler-swipe-fold");
      row.style.height = "";
      setArmed(false);
      setReveal(null);
    };

    /** Spring from here toward `target`, starting at `velocity` px/ms. */
    const springTo = (
      target: number,
      velocity: number,
      spring: { stiffness: number; damping: number },
      done: () => void,
      clamp = false,
    ) => {
      stopMotion();
      if (prefersReducedMotion()) {
        paint(target);
        done();
        return;
      }
      let v = velocity;
      // Frame timestamps mark the frame's start, which can predate a
      // performance.now() read taken just before: time from the first frame.
      let last: number | null = null;
      const tick = (now: number) => {
        const dt = last === null ? 1000 / 60 : Math.max(0, now - last);
        const next = stepSpring(x, v, target, dt, spring);
        last = now;
        v = next.velocity;
        // A slide-out stops at the edge rather than bouncing back into view.
        const pos = clamp && Math.sign(next.x - target) === Math.sign(target)
          ? target
          : next.x;
        paint(pos);
        if (pos === target || springAtRest(pos, v, target)) {
          paint(target);
          frame = null;
          done();
          return;
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const settle = (velocity: number) => {
      setPhase("settle");
      springTo(0, velocity, SPRING_BACK, reset);
    };

    /** Rest aside with the action showing as a button, until dismissed. */
    const openRow = (velocity: number) => {
      if (closeOpenRow && closeOpenRow !== closeThis) closeOpenRow();
      closeOpenRow = closeThis;
      setArmed(false);
      setPhase("open");
      springTo(Math.sign(x) * OPEN_PX, velocity, SPRING_BACK, () => {});
      listenWhileOpen(true);
    };

    function closeThis() {
      if (phaseRef.current !== "open") return;
      listenWhileOpen(false);
      if (closeOpenRow === closeThis) closeOpenRow = null;
      settle(0);
    }

    const commitOpen = () => {
      if (phaseRef.current !== "open" || !action) return;
      listenWhileOpen(false);
      if (closeOpenRow === closeThis) closeOpenRow = null;
      setArmed(true);
      if (action.removes) {
        remove(action, 0);
        return;
      }
      latest.current.onCommit(action, x);
      settle(0);
    };

    // An open row closes on any press outside its button (a press on the
    // row itself closes it without opening the thread), a scroll, or Escape.
    const onOpenPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (row.querySelector(".spooler-swipe-underlay")?.contains(target)) return;
      if (row.contains(target)) suppressClickUntil = performance.now() + 400;
      closeThis();
    };
    const onOpenKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Closing the row is what this Escape was for: do not also clear the
      // search or dismiss a dialog behind it.
      event.stopPropagation();
      closeThis();
    };
    const onOpenScroll = () => closeThis();
    let openListening = false;
    function listenWhileOpen(on: boolean) {
      if (on === openListening) return;
      openListening = on;
      const method = on ? "addEventListener" : "removeEventListener";
      document[method]("pointerdown", onOpenPointerDown as EventListener, true);
      document[method]("keydown", onOpenKeyDown as EventListener, true);
      document[method]("scroll", onOpenScroll, true);
    }

    const remove = (committed: SwipeActionView, velocity: number) => {
      pending = committed;
      row.style.height = `${row.offsetHeight}px`;
      setPhase("out");
      const target = Math.sign(x) * (width + 16);
      // At least a brisk push outward, so a slow drag past the line still
      // leaves decisively.
      const push = Math.sign(x) * Math.max(Math.abs(velocity), 1.2);
      springTo(target, push, SPRING_OUT, () => {
        setPhase("fold");
        row.style.setProperty("--spooler-swipe-fold", `${FOLD_MS}ms`);
        row.style.height = "0px";
        timer = window.setTimeout(() => {
          setPhase("gone");
          deliver();
          timer = window.setTimeout(() => {
            if (phaseRef.current === "gone") restore();
          }, RESTORE_MS);
        }, prefersReducedMotion() ? 0 : FOLD_MS);
      }, true);
    };

    const restore = () => {
      row.style.height = "";
      setPhase("settle");
      springTo(0, 0, SPRING_BACK, reset);
    };
    restoreRef.current = restore;

    /** Catch the row wherever it is (even mid-settle) and start tracking. */
    const beginDrag = (input: "touch" | "trackpad") => {
      if (phaseRef.current === "open") {
        listenWhileOpen(false);
        if (closeOpenRow === closeThis) closeOpenRow = null;
      }
      // A trackpad press never reaches the open row's pointerdown listener,
      // so starting here is what closes another row that was left open.
      if (closeOpenRow && closeOpenRow !== closeThis) closeOpenRow();
      stopMotion();
      width = row.offsetWidth;
      threshold = swipeThreshold(width, input);
      samples = [];
      setPhase("drag");
      latest.current.onStart?.();
      return x;
    };

    /** `travel` is how far the row should follow, before resistance. */
    const dragTo = (travel: number) => {
      const nextSide: SwipeSide | null =
        travel > 0 ? "right" : travel < 0 ? "left" : side;
      if (nextSide !== side) {
        side = nextSide;
        action = side === "right"
          ? latest.current.right
          : side === "left"
            ? latest.current.left
            : null;
        setArmed(false);
        setReveal(side ? { side, action } : null);
      }
      paint(swipeOffset(travel, width, !!action));

      const nextArmed = !!action && Math.abs(x) >= threshold;
      if (nextArmed && !armed) navigator.vibrate?.(8);
      setArmed(nextArmed);

      const now = performance.now();
      samples.push({ x: travel, t: now });
      while (samples.length > 2 && now - samples[0].t > VELOCITY_WINDOW_MS) {
        samples.shift();
      }
    };

    /** `openBelow`: short of arming, rest open instead of springing home. */
    const release = (openBelow = false) => {
      const first = samples[0];
      const last = samples[samples.length - 1];
      // Movement that ended before a pause is not a flick: a finger or
      // fingers resting before the release carry no speed into it.
      const moving = !!last && performance.now() - last.t <= VELOCITY_WINDOW_MS;
      const velocity =
        moving && first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
      if (action && shouldCommitSwipe(x, velocity, threshold)) {
        setArmed(true);
        if (action.removes) {
          remove(action, velocity);
          return;
        }
        latest.current.onCommit(action, x);
        settle(velocity);
        return;
      }
      if (openBelow && action && Math.abs(x) >= OPEN_MIN_PX) {
        openRow(velocity);
        return;
      }
      settle(velocity);
    };

    const onTouchStart = (event: TouchEvent) => {
      const phase = phaseRef.current;
      if (
        event.touches.length !== 1 ||
        (phase && phase !== "settle" && phase !== "open")
      ) {
        // A second finger ends a swipe in progress. Letting go of tracking
        // alone would leave touchend nothing to settle and the row stuck.
        if (locked) {
          locked = false;
          suppressClickUntil = performance.now() + 400;
          settle(0);
        }
        tracking = false;
        return;
      }
      // The drag grip has its own long-press drag to a section.
      if ((event.target as Element | null)?.closest?.(".spooler-row-grip")) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      tracking = true;
      locked = false;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!locked) {
        if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          // A scroll: let the list have it.
          tracking = false;
          return;
        }
        locked = true;
        originX = touch.clientX - beginDrag("touch");
      }
      if (event.cancelable) event.preventDefault();
      // Keep the host's own drawer gestures out of a row swipe.
      event.stopPropagation();
      dragTo(touch.clientX - originX);
    };

    const onTouchEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!locked) return;
      locked = false;
      suppressClickUntil = performance.now() + 400;
      release();
    };

    const onTouchCancel = () => {
      if (!tracking) return;
      tracking = false;
      if (!locked) return;
      locked = false;
      settle(0);
    };

    // Trackpads (a Mac's, or an iPad's Magic Keyboard): a two-finger
    // sideways scroll arrives as pixel wheel events with no lift-off signal,
    // so a short pause ends the swipe. The momentum tail after the lift is
    // swallowed until it goes quiet, so it can neither scroll the list nor
    // start a second swipe.
    let wheel: {
      dx: number;
      dy: number;
      travel: number;
      locked: boolean;
      recent: number[];
    } | null = null;
    let wheelIgnored = false;
    let wheelCooldown = false;
    let wheelTimer: number | null = null;
    // Wheel events go to whatever is under the cursor, and the row slides out
    // from under it. Once a swipe is underway (and through its momentum
    // tail) the window routes every wheel event here instead.
    let followingWindow = false;
    const followWindow = (on: boolean) => {
      if (on === followingWindow) return;
      followingWindow = on;
      if (on) window.addEventListener("wheel", onWindowWheel, { capture: true, passive: false });
      else window.removeEventListener("wheel", onWindowWheel, { capture: true });
    };

    const armWheelIdle = () => {
      if (wheelTimer !== null) clearTimeout(wheelTimer);
      const wait = wheelCooldown || !wheel?.locked
        ? WHEEL_COOLDOWN_MS
        : looksLikeMomentumEnd(wheel.recent)
          ? WHEEL_LIFT_MS
          : armed
            ? WHEEL_HOLD_MS
            : WHEEL_REST_MS;
      wheelTimer = window.setTimeout(onWheelIdle, wait);
    };

    const onWheelIdle = () => {
      wheelTimer = null;
      const gesture = wheel;
      wheel = null;
      wheelIgnored = false;
      if (gesture?.locked) {
        release(true);
        wheelCooldown = true;
        armWheelIdle();
        return;
      }
      wheelCooldown = false;
      followWindow(false);
    };

    const onWheel = (event: WheelEvent) => {
      // Pinch-zoom, line-stepped mouse wheels and Shift+wheel (a mouse's way
      // of scrolling sideways) are not swipes.
      if (event.ctrlKey || event.shiftKey || event.deltaMode !== 0) return;
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (wheelCooldown) {
        if (sideways) event.preventDefault();
        armWheelIdle();
        return;
      }
      if (wheelIgnored) {
        armWheelIdle();
        return;
      }
      if (!wheel) {
        const phase = phaseRef.current;
        if (phase && phase !== "settle" && phase !== "open") return;
        wheel = { dx: 0, dy: 0, travel: 0, locked: false, recent: [] };
      }
      wheel.recent.push(Math.abs(event.deltaX));
      if (wheel.recent.length > 8) wheel.recent.shift();
      if (!wheel.locked) {
        if (sideways && Math.abs(event.deltaX) >= WHEEL_NOTCH_PX) {
          closeThis();
          wheel = null;
          wheelIgnored = true;
          armWheelIdle();
          return;
        }
        wheel.dx += event.deltaX;
        wheel.dy += event.deltaY;
        if (Math.abs(wheel.dx) < SWIPE_SLOP_PX && Math.abs(wheel.dy) < SWIPE_SLOP_PX) {
          armWheelIdle();
          if (sideways) event.preventDefault();
          return;
        }
        if (Math.abs(wheel.dy) >= Math.abs(wheel.dx)) {
          closeThis();
          wheel = null;
          wheelIgnored = true;
          armWheelIdle();
          return;
        }
        wheel.locked = true;
        wheel.travel = beginDrag("trackpad");
        followWindow(true);
      }
      armWheelIdle();
      event.preventDefault();
      event.stopPropagation();
      // Content-style direction: the row moves the way a sideways scroll
      // would move the page, which follows the fingers with natural scroll.
      wheel.travel -= event.deltaX;
      dragTo(wheel.travel);
    };

    const onRowWheel = (event: WheelEvent) => {
      if (!followingWindow) onWheel(event);
    };
    function onWindowWheel(event: WheelEvent) {
      onWheel(event);
    }

    // Capture on this row before its links handle the click. Listening on
    // window made every app click visit every mounted row, even outside Spooler.
    const onClickCapture = (event: MouseEvent) => {
      if (
        phaseRef.current === "open" &&
        row.querySelector(".spooler-swipe-underlay")?.contains(event.target as Node)
      ) {
        event.preventDefault();
        event.stopPropagation();
        commitOpen();
        return;
      }
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    row.addEventListener("touchstart", onTouchStart, { passive: true });
    row.addEventListener("touchmove", onTouchMove, { passive: false });
    row.addEventListener("touchend", onTouchEnd);
    row.addEventListener("touchcancel", onTouchCancel);
    row.addEventListener("click", onClickCapture, true);
    row.addEventListener("wheel", onRowWheel, { passive: false });
    return () => {
      row.removeEventListener("wheel", onRowWheel);
      followWindow(false);
      if (wheelTimer !== null) clearTimeout(wheelTimer);
      row.removeEventListener("touchstart", onTouchStart);
      row.removeEventListener("touchmove", onTouchMove);
      row.removeEventListener("touchend", onTouchEnd);
      row.removeEventListener("touchcancel", onTouchCancel);
      row.removeEventListener("click", onClickCapture, true);
      restoreRef.current = null;
      // A swipe the user finished must not vanish because the row remounted
      // or swiping was switched off while it slid out.
      deliver();
      reset();
    };
  }, [enabled, rowRef]);

  useEffect(() => {
    if (phaseRef.current === "gone") restoreRef.current?.();
  }, [restoreKey]);

  return reveal;
}
