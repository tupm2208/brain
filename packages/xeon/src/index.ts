/**
 * @file Public surface of the Xeon package, used by the tests and by `main.ts`.
 */

export * from "./protocol";
export * from "./config";
export * from "./app";
export * from "./support/clock";
export * from "./support/logger";
export * from "./support/ticket-kit";
export * from "./license/key-format";
export * from "./license/signing-key";
export * from "./license/ledger";
export * from "./license/license-service";
export * from "./gateway/landing-gateway";
export * from "./gateway/service-ticket-provider";
export * from "./gateway/conversation-memory";
export * from "./brain/brain-service";
export * from "./agent/chat-model";
export * from "./agent/sales-agent";
export * from "./meta/meta-packet";
export * from "./meta/graph-client";
export * from "./meta/meta-forwarder";
export * from "./http/http-utils";
export * from "./http/rate-limiter";
export * from "./http/admin-session";
export * from "./http/static-pages";
export * from "./http/health-controller";
export * from "./http/license-controller";
export * from "./http/inbound-controller";
export * from "./http/meta-controller";
export * from "./http/write-controller";
export * from "./content/brief";
export * from "./content/text-model";
export * from "./content/content-writer";
export * from "./ai/usage-context";
export * from "./ai/price-table";
export * from "./ai/usage-ledger";
export * from "./ai/metered-models";
export * from "./ai/knowledge";
export * from "./ai/ai-desk";
export * from "./http/ai-controller";
export * from "./content/content-desk";
export * from "./http/content-controller";
export * from "./knowledge/line-dna";
export * from "./knowledge/sample-profiles";
export * from "./knowledge/industry-packs";
export * from "./knowledge/knowledge-desk";
export * from "./http/knowledge-controller";
export * from "./video/studio-ticket";
export * from "./video/studio-service";
export * from "./http/video-controller";
// NOT exported from the barrel on purpose: it is the only file that loads the Anthropic SDK, and
// re-exporting it here would pull that SDK into every consumer — including tests about licences,
// which then carry its open handles into their own teardown. `app.ts` imports it by path.
export * from "./http/admin-controller";
export * from "./http/server";
