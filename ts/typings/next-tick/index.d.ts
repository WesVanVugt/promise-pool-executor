declare const nextTick: (fn: () => void) => void;

declare module "next-tick" {
    export = nextTick;
}
