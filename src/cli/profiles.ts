/**
 * `prestron profiles` — list all available encoding profiles.
 */
import { Command } from "commander";
import { PROFILES } from "../core/policy/profiles.js";

export function makeProfilesCommand(): Command {
  return new Command("profiles")
    .description("List available encoding profiles")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      const profiles = Object.values(PROFILES);

      if (options.json) {
        console.log(JSON.stringify(profiles, null, 2));
        return;
      }

      console.log("\nAvailable profiles:\n");
      console.log("  NAME          CODEC    CRF  PRESET   PIX_FMT      X265_PARAMS");
      console.log("  ─────────────────────────────────────────────────────────────────");
      for (const p of profiles) {
        const name = p.name.padEnd(13);
        const codec = p.codec.padEnd(8);
        const crf = String(p.crf).padEnd(4);
        const preset = p.preset.padEnd(8);
        const pix = p.pixFmt.padEnd(12);
        const x265 = p.x265Params ?? "—";
        console.log(`  ${name} ${codec} ${crf} ${preset} ${pix} ${x265}`);
      }
      console.log();
    });
}
