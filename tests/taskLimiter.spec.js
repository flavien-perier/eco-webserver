const TaskLimiter = require("../src/taskLimiter.cts");

describe("TaskLimiter", () => {
    it("bounds concurrency and drains queued tasks", async () => {
        const limiter = new TaskLimiter(2, 2);
        let active = 0;
        let maximumActive = 0;

        const tasks = Array.from({ length: 4 }, () => limiter.run(async () => {
            active++;
            maximumActive = Math.max(maximumActive, active);
            await new Promise(resolve => setTimeout(resolve, 10));
            active--;
        }));

        await Promise.all(tasks);
        expect(maximumActive).toEqual(2);
    });

    it("rejects excess work with a retryable status", async () => {
        const limiter = new TaskLimiter(1, 0);
        let release;
        const first = limiter.run(() => new Promise(resolve => {
            release = resolve;
        }));
        const second = limiter.run(async () => {});

        await expectAsync(second).toBeRejectedWithError("Processing queue is full");
        release();
        await first;
    });
});
