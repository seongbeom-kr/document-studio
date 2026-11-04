import fontPack from "../../../core/src/font-pack.json";
import schema from "../../contracts/v3/bundle.json";
import { digestV3 } from "./contract";
import type { RuntimeProfileV3 } from "./types";
export async function workingRuntimeV3(): Promise<RuntimeProfileV3> {
  return {
    parser: "document-studio/template@0.5.0",
    renderer: "document-studio/template@0.5.0",
    exporter: "working-xml",
    verifier: "document-studio/template@0.5.0",
    schemaDigest: await digestV3(schema),
    fontPackDigest: await digestV3(fontPack),
  };
}
