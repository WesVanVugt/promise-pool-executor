import { ActivePromiseCount, ConcurrencyLimit, FreeSlots, FrequencyLimit, PromisePoolGroup, PromisePoolGroupOptions } from "./group";
export interface InvocationLimit {
    /**
     * Limits the number of times the generator function will be invoked.
     */
    invocationLimit: number;
}
export interface TaskOptionsBase {
    /**
     * An array of groups, each of which can be used to impose additional restrictions of the task, or a subset of
     * tasks within the pool. Groups can also be used to respond to the completion of larger tasks comprised of
     * smaller task components.
     */
    groups?: PromisePoolGroup[];
    /**
     * Starts the task in a paused state if set to true.
     */
    paused?: boolean;
}
export interface GenericTaskOptionsBase extends PromisePoolGroupOptions, TaskOptionsBase, Partial<InvocationLimit> {
}
export interface GenericTaskOptions<R> extends GenericTaskOptionsBase {
    /**
     * A function which returns a new promise or undefined each time it is run. If the function returns undefined, the
     * task will be flagged as completed unless it is in a paused state.
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each
     * promise returned.
     */
    generator(this: PromisePoolTask<any[]>, invocation: number): R | PromiseLike<R> | undefined | null | void;
}
export interface GenericTaskConvertedOptions<I, R> extends GenericTaskOptionsBase {
    /**
     * A function which returns a new promise or undefined each time it is run. If the function returns undefined, the
     * task will be flagged as completed unless it is in a paused state.
     * @param invocation The invocation number for this call, starting at 0 and incrementing by 1 for each
     * promise returned.
     */
    generator(this: PromisePoolTask<any>, invocation: number): I | PromiseLike<I> | undefined | null | void;
    /**
     * Converts the results of the task upon completion.
     */
    resultConverter(result: I[]): R;
}
export declare enum TaskState {
    /**
     * The task is active and promises will be generated according to the limits set.
     */
    Active = 0,
    /**
     * The task is paused and may be ended or resumed later. Any outstanding promises will continue to run.
     */
    Paused = 1,
    /**
     * The task has no more work to do and will terminate when all outstanding promises have ended.
     */
    Exhausted = 2,
    /**
     * All outstanding promises have ended and the result has been returned or an error thrown.
     */
    Terminated = 3,
}
export interface TaskStateProperty {
    /**
     * An enumeration representing the current state of the task.
     */
    readonly state: TaskState;
}
export interface EndMethod {
    /**
     * Ends the task, preventing the generator function from being called again.
     */
    end(): void;
}
export interface PromisePoolTask<R> extends InvocationLimit, ConcurrencyLimit, FrequencyLimit, ActivePromiseCount, FreeSlots, TaskStateProperty, EndMethod {
    /**
     * The number of times the task has been invoked.
     */
    readonly invocations: number;
    /**
     * Puts the task in a paused state.
     */
    pause(): void;
    /**
     * Resumes a paused task.
     */
    resume(): void;
    /**
     * Returns a promise which resolves to the result of the task upon completion, or rejects on error.
     */
    promise(): Promise<R>;
}
