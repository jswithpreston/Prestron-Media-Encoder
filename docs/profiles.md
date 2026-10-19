# Encoding Profiles

Prestron Media Encoder provides four carefully tuned encoding profiles built on top of `libx265`.
All profiles output **10-bit color (`yuv420p10le`)** by default to significantly reduce banding,
preserve original resolution and frame rates, and stream-copy all audio, subtitle, attachment,
and chapter tracks.

## Profile Summary

| Profile        | Codec     | CRF | Preset   | Pix Format    | x265 Extra Parameters              |
| -------------- | --------- | --- | -------- | ------------- | ---------------------------------- |
| `movie`        | `libx265` | 21  | `medium` | `yuv420p10le` | `aq-mode=3`                        |
| `series`       | `libx265` | 22  | `medium` | `yuv420p10le` | —                                  |
| `anime`        | `libx265` | 19  | `medium` | `yuv420p10le` | `aq-mode=3:psy-rd=1.0:deblock=1,1` |
| `conservative` | `libx265` | 20  | `medium` | `yuv420p10le` | —                                  |

## Rationale

### Movie (`crf=21`, `aq-mode=3`)

Features and films often contain dark scenes, subtle gradients, and complex film grain.
`aq-mode=3` (Auto-Variance AQ with bias to dark scenes) allocates extra bits to flat dark
areas to prevent noticeable macroblocking and color stepping.

### Series (`crf=22`)

Television series balance high quality with space savings across dozens of episodes.
A CRF of 22 delivers transparent quality for typical broadcast and streaming sources with
excellent compression efficiency.

### Anime (`crf=19`, `aq-mode=3:psy-rd=1.0:deblock=1,1`)

Animation presents unique challenges for modern codecs: flat colored areas, sharp line art,
and high contrast edges.

- `crf=19`: Preserves fine line art and gradient backgrounds.
- `aq-mode=3`: Prevents banding and artifacting in flat sky and background fills.
- `psy-rd=1.0`: Preserves line sharpness and edge contrast without blurring.
- `deblock=1,1`: Maintains clean lines and reduces blocking artifacts between flat segments.

### Conservative (`crf=20`)

Used as the automatic fallback whenever content classification confidence falls below 0.6,
or when sources cannot be definitively categorized. A CRF of 20 ensures high visual fidelity
regardless of content type.

## CLI Usage

List all available profiles:

```bash
prestron profiles
prestron profiles --json
```

Override profile in encode:

```bash
prestron encode /path/to/media --yes --profile anime
prestron encode /path/to/media --yes --profile movie --crf 20 --preset slow
```
