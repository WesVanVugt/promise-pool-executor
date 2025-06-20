import defer, { DeferredPromise } from "p-defer";

/**
 * Deferred object which can only be considered unhandled if used. Also aggregates multiple rejections like Promise.all.
 */
export class OptionalDeferredPromise<T> {
	private deferred?: DeferredPromise<T>;

	private settled?: true;

	private readonly results: (T | Promise<T>)[] = [];

	public promise(): Promise<T> {
		if (!this.deferred) {
			this.deferred = defer<T>();
			if (this.results.length) {
				this.settled = true;
				this.deferred.resolve(this.results[0]!);
				Promise.all(this.results).catch(() => {});
				this.results.length = 0;
			}
		}
		return this.deferred.promise;
	}

	public resolve(value: T | Promise<T>): void {
		if (!this.deferred) {
			this.results.push(value);
		} else if (!this.settled) {
			this.settled = true;
			this.deferred.resolve(value);
		} else {
			Promise.resolve(value).catch(() => {});
		}
	}
}
