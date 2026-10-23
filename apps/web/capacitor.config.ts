import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.hodos.app",
  appName: "Hodos",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    backgroundColor: "#0b0f14",
  },
};

export default config;
