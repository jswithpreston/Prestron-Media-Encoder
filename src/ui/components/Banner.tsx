/**
 * Banner — displays the Prestron Media Encoder ASCII banner.
 *
 * Behavior:
 *   - Full banner (6 rows) when cols ≥ 70 AND UTF-8 locale is available.
 *   - One-line fallback "PRESTRON Media Encoder" otherwise.
 *   - Optional color gradient when hasColor is true.
 */

import React from "react";
import { Box, Text } from "ink";

// ---------------------------------------------------------------------------
// Banner art
// ---------------------------------------------------------------------------

const BANNER_LINES = [
  "██████╗ ██████╗ ███████╗███████╗████████╗██████╗  ██████╗ ███╗   ██╗",
  "██╔══██╗██╔══██╗██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗████╗  ██║",
  "██████╔╝██████╔╝█████╗  ███████╗   ██║   ██████╔╝██║   ██║██╔██╗ ██║",
  "██╔═══╝ ██╔══██╗██╔══╝  ╚════██║   ██║   ██╔══██╗██║   ██║██║╚██╗██║",
  "██║     ██║  ██║███████╗███████║   ██║   ██║  ██║╚██████╔╝██║ ╚████║",
  "╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝",
] as const;

const GRADIENT_COLORS = ["#4fc3f7", "#29b6f6", "#03a9f4", "#039be5", "#0288d1", "#0277bd"] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BannerProps {
  version: string;
  columns: number;
  isUtf8: boolean;
  hasColor: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Banner({ version, columns, isUtf8, hasColor }: BannerProps): React.ReactElement {
  const showFull = columns >= 70 && isUtf8;

  if (!showFull) {
    return (
      <Box marginBottom={1}>
        <Text bold {...(hasColor ? { color: "cyan" as const } : {})}>
          {`PRESTRON Media Encoder  v${version}`}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {BANNER_LINES.map((line, i) => (
        <Text
          key={i}
          {...(hasColor ? { color: GRADIENT_COLORS[i % GRADIENT_COLORS.length] as string } : {})}
        >
          {line}
        </Text>
      ))}
      <Text dimColor={!hasColor} {...(hasColor ? { color: "cyan" as const } : {})}>
        {"                  Media Encoder  v" + version}
      </Text>
    </Box>
  );
}
