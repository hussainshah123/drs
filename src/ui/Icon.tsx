/**
 * Icon — crisp stroke SVG icons (Feather / Lucide geometry) that tint with the
 * current color, replacing emoji glyphs across the app. 24×24 viewBox, 2px
 * stroke, round caps. Add a new icon by dropping its paths into ICONS.
 */
import React from 'react';
import Svg, {Circle, Line, Path, Polygon, Polyline, Rect} from 'react-native-svg';

export type IconName =
  | 'home'
  | 'message'
  | 'bell'
  | 'shield'
  | 'search'
  | 'edit'
  | 'plus'
  | 'close'
  | 'send'
  | 'check'
  | 'back'
  | 'chevron'
  | 'info'
  | 'users'
  | 'monitor'
  | 'smartphone'
  | 'pointer'
  | 'settings'
  | 'logout'
  | 'inbox';

export function Icon({
  name,
  size = 24,
  color = '#FFFFFF',
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const p = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {render(name, p)}
    </Svg>
  );
}

type P = {
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  fill: 'none';
};

function render(name: IconName, p: P): React.ReactNode {
  switch (name) {
    case 'home':
      return (
        <>
          <Path {...p} d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <Polyline {...p} points="9 22 9 12 15 12 15 22" />
        </>
      );
    case 'message':
      return (
        <Path
          {...p}
          d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"
        />
      );
    case 'bell':
      return (
        <>
          <Path {...p} d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <Path {...p} d="M13.73 21a2 2 0 0 1-3.46 0" />
        </>
      );
    case 'shield':
      return <Path {...p} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
    case 'search':
      return (
        <>
          <Circle {...p} cx="11" cy="11" r="8" />
          <Line {...p} x1="21" y1="21" x2="16.65" y2="16.65" />
        </>
      );
    case 'edit':
      return (
        <>
          <Path {...p} d="M12 20h9" />
          <Path {...p} d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
        </>
      );
    case 'plus':
      return (
        <>
          <Line {...p} x1="12" y1="5" x2="12" y2="19" />
          <Line {...p} x1="5" y1="12" x2="19" y2="12" />
        </>
      );
    case 'close':
      return (
        <>
          <Line {...p} x1="18" y1="6" x2="6" y2="18" />
          <Line {...p} x1="6" y1="6" x2="18" y2="18" />
        </>
      );
    case 'send':
      return (
        <>
          <Line {...p} x1="22" y1="2" x2="11" y2="13" />
          <Polygon {...p} points="22 2 15 22 11 13 2 9 22 2" />
        </>
      );
    case 'check':
      return <Polyline {...p} points="20 6 9 17 4 12" />;
    case 'back':
      return <Polyline {...p} points="15 18 9 12 15 6" />;
    case 'chevron':
      return <Polyline {...p} points="9 18 15 12 9 6" />;
    case 'info':
      return (
        <>
          <Circle {...p} cx="12" cy="12" r="10" />
          <Line {...p} x1="12" y1="16" x2="12" y2="12" />
          <Line {...p} x1="12" y1="8" x2="12.01" y2="8" />
        </>
      );
    case 'users':
      return (
        <>
          <Path {...p} d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <Circle {...p} cx="9" cy="7" r="4" />
          <Path {...p} d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <Path {...p} d="M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      );
    case 'monitor':
      return (
        <>
          <Rect {...p} x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <Line {...p} x1="8" y1="21" x2="16" y2="21" />
          <Line {...p} x1="12" y1="17" x2="12" y2="21" />
        </>
      );
    case 'smartphone':
      return (
        <>
          <Rect {...p} x="5" y="2" width="14" height="20" rx="2" ry="2" />
          <Line {...p} x1="12" y1="18" x2="12.01" y2="18" />
        </>
      );
    case 'pointer':
      return (
        <>
          <Path {...p} d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51z" />
          <Path {...p} d="M13 13l6 6" />
        </>
      );
    case 'settings':
      return (
        <>
          <Circle {...p} cx="12" cy="12" r="3" />
          <Path
            {...p}
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </>
      );
    case 'logout':
      return (
        <>
          <Path {...p} d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <Polyline {...p} points="16 17 21 12 16 7" />
          <Line {...p} x1="21" y1="12" x2="9" y2="12" />
        </>
      );
    case 'inbox':
      return (
        <>
          <Polyline {...p} points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <Path {...p} d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </>
      );
  }
}
