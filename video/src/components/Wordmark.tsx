import React from 'react';

import { SAFE_TOP, theme } from '../theme';

const WORDMARK_SIZE = 54;
const TAGLINE_SIZE = 30;

export const Wordmark: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      top: SAFE_TOP,
      left: 0,
      right: 0,
      textAlign: 'center',
      color: theme.colors.accent
    }}
  >
    <div style={{ fontFamily: 'Montserrat', fontWeight: 700, fontSize: WORDMARK_SIZE }}>
      LyricLike
    </div>
    <div
      style={{
        marginTop: 8,
        fontFamily: theme.fontFamily,
        fontSize: TAGLINE_SIZE,
        color: theme.colors['ink-faded']
      }}
    >
      see how every line rhymes
    </div>
  </div>
);
