import { info } from "@actions/core";

export const Timer = {
  start(identifier: string, icon?: string) {
    const iconText = icon ? `${icon} ` : "";
    info(`${iconText}running "${identifier}"...`);
    const startTime = performance.now();

    return () => {
      const endTime = performance.now();
      const durationMs = endTime - startTime;

      // Format duration intelligently
      const formattedDuration =
        durationMs < 1000
          ? `${durationMs.toFixed(2)}ms`
          : `${(durationMs / 1000).toFixed(2)}s`;

      info(
        `${iconText}finished running "${identifier}". took ${formattedDuration}!`
      );
    };
  },
};
