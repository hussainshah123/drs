/**
 * App-wide decorative background: a dim starfield with a couple of bright
 * nodes that jump from point to point across the whole screen, each
 * trailing a short comet-like tail of fading echoes — "connected
 * everywhere" as a quiet ambient cue, not a literal diagram. Star
 * positions are generated once per size; only the balls (and their
 * echoes) animate, purely via transform/opacity so it all runs on the
 * native thread regardless of JS load elsewhere in the app.
 */
import React, {useEffect, useMemo, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {T} from './theme';

type Pt = {x: number; y: number};

/** Deterministic pseudo-random in [0,1) — stable across re-renders, no seed-state needed. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function useStars(width: number, height: number, count: number) {
  return useMemo(() => {
    const stars: {x: number; y: number; r: number; o: number}[] = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: rand(i * 1.37 + 1) * width,
        y: rand(i * 2.71 + 7) * height,
        r: 0.8 + rand(i * 3.14 + 3) * 1.1,
        o: 0.18 + rand(i * 4.62 + 5) * 0.32,
      });
    }
    return stars;
  }, [width, height, count]);
}

function Twinkle({x, y, r, o, delay}: {x: number; y: number; r: number; o: number; delay: number}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {toValue: 1, duration: 1500, delay, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
        Animated.timing(anim, {toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);
  const opacity = anim.interpolate({inputRange: [0, 1], outputRange: [o, Math.min(o * 2.4, 0.85)]});
  return (
    <Animated.View style={[styles.star, {width: r * 2, height: r * 2, borderRadius: r, left: x, top: y, opacity}]} />
  );
}

/** A single dot that holds at each point in `path`, then animates to the next, forever. */
function BallCore({
  path,
  size,
  color,
  travelMs,
  holdMs,
  delay,
  opacity,
  glow,
}: {
  path: Pt[];
  size: number;
  color: string;
  travelMs: number;
  holdMs: number;
  delay: number;
  opacity: number;
  glow: boolean;
}) {
  const x = useRef(new Animated.Value(path[0].x)).current;
  const y = useRef(new Animated.Value(path[0].y)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const steps: Animated.CompositeAnimation[] = [];
    for (let i = 0; i < path.length; i++) {
      const next = path[(i + 1) % path.length];
      steps.push(Animated.delay(holdMs));
      steps.push(
        Animated.parallel([
          Animated.timing(x, {toValue: next.x, duration: travelMs, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
          Animated.timing(y, {toValue: next.y, duration: travelMs, easing: Easing.inOut(Easing.quad), useNativeDriver: true}),
          Animated.sequence([
            Animated.timing(bounce, {toValue: 1, duration: travelMs / 2, easing: Easing.out(Easing.quad), useNativeDriver: true}),
            Animated.timing(bounce, {toValue: 0, duration: travelMs / 2, easing: Easing.in(Easing.quad), useNativeDriver: true}),
          ]),
          Animated.sequence([
            Animated.timing(scale, {toValue: 1.5, duration: travelMs / 2, easing: Easing.out(Easing.quad), useNativeDriver: true}),
            Animated.timing(scale, {toValue: 1, duration: travelMs / 2, easing: Easing.in(Easing.quad), useNativeDriver: true}),
          ]),
        ]),
      );
    }
    const loop = Animated.loop(Animated.sequence(steps));
    const timer = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
    // path/size/color/opacity/glow are fixed per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travelMs, holdMs, delay]);

  const liftY = bounce.interpolate({inputRange: [0, 1], outputRange: [0, -14]});

  return (
    <Animated.View
      style={[
        styles.ball,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity,
          ...(glow
            ? {shadowColor: color, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: {width: 0, height: 0}}
            : null),
          transform: [{translateX: x}, {translateY: Animated.add(y, liftY)}, {scale}],
        },
      ]}
    />
  );
}

/**
 * A node plus a short comet tail: `trailCount` dimmer, smaller echoes of
 * the same ball running the identical path/timing, each started slightly
 * later — since the sequence is deterministic and loops forever, that
 * fixed head-start keeps each echo a constant beat behind the lead node,
 * which reads as a fading tail chasing it around the path.
 */
function JumpingBall({
  path,
  size,
  color,
  travelMs = 900,
  holdMs = 1300,
  delay = 0,
  trailCount = 3,
}: {
  path: Pt[];
  size: number;
  color: string;
  travelMs?: number;
  holdMs?: number;
  delay?: number;
  trailCount?: number;
}) {
  return (
    <>
      {Array.from({length: trailCount}).map((_, i) => (
        <BallCore
          key={i}
          path={path}
          size={Math.max(size * (1 - (i + 1) * 0.22), size * 0.3)}
          color={color}
          travelMs={travelMs}
          holdMs={holdMs}
          delay={delay + (i + 1) * 120}
          opacity={Math.max(0.4 - i * 0.12, 0.08)}
          glow={false}
        />
      ))}
      <BallCore path={path} size={size} color={color} travelMs={travelMs} holdMs={holdMs} delay={delay} opacity={1} glow />
    </>
  );
}

export function ConnectionGlobe({width, height}: {width: number; height: number}) {
  const stars = useStars(width, height, Math.round((width * height) / 9000));

  const pct = (fx: number, fy: number): Pt => ({x: fx * width, y: fy * height});

  return (
    <View style={[StyleSheet.absoluteFill, {width, height}]} pointerEvents="none">
      {stars.map((s, i) => (
        <Twinkle key={i} x={s.x} y={s.y} r={s.r} o={s.o} delay={(i * 137) % 1800} />
      ))}
      <JumpingBall
        path={[pct(0.12, 0.08), pct(0.78, 0.18), pct(0.58, 0.4), pct(0.2, 0.32), pct(0.85, 0.55)]}
        size={7}
        color={T.accent}
        travelMs={950}
        holdMs={1400}
      />
      <JumpingBall
        path={[pct(0.7, 0.62), pct(0.3, 0.7), pct(0.15, 0.48), pct(0.6, 0.78), pct(0.88, 0.85)]}
        size={5.5}
        color={T.violet}
        travelMs={850}
        holdMs={1600}
        delay={800}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  star: {position: 'absolute', backgroundColor: '#FFFFFF'},
  ball: {position: 'absolute', top: 0, left: 0},
});
