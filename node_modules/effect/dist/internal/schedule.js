import { constant, constTrue, dual, identity } from "../Function.js";
import * as Option from "../Option.js";
import * as Pull from "../Pull.js";
import * as Result from "../Result.js";
import * as Schedule from "../Schedule.js";
import { internalCall } from "../Utils.js";
import * as core from "./core.js";
import * as effect from "./effect.js";
const findErrorOnly = cause => cause.reasons.every(core.isFailReason) ? effect.findError(cause) : Result.fail(cause);
/** @internal */
export const repeatOrElse = /*#__PURE__*/dual(3, (self, schedule, orElse) => effect.flatMap(Schedule.toStepWithMetadata(schedule), step => {
  let meta = Schedule.CurrentMetadata.defaultValue();
  return effect.catchCauseFilter(Pull.catchDone(effect.forever(effect.tap(effect.flatMap(effect.suspend(() => effect.provideService(self, Schedule.CurrentMetadata, meta)), step), meta_ => effect.sync(() => {
    meta = meta_;
  })), {
    disableYield: true
  }), out => effect.succeed(out)), findErrorOnly, error => orElse(error, meta.attempt === 0 ? Option.none() : Option.some(meta)));
}));
/** @internal */
export const retryOrElse = /*#__PURE__*/dual(3, (self, policy, orElse) => effect.flatMap(Schedule.toStepWithMetadata(policy), step => {
  let meta = Schedule.CurrentMetadata.defaultValue();
  let lastError;
  const loop = effect.catchCauseFilter(effect.suspend(() => effect.provideService(self, Schedule.CurrentMetadata, meta)), findErrorOnly, error => {
    lastError = error;
    return effect.flatMap(step(error), meta_ => {
      meta = meta_;
      return loop;
    });
  });
  return Pull.catchDone(loop, out => internalCall(() => orElse(lastError, out)));
}));
/** @internal */
export const repeat = /*#__PURE__*/dual(2, (self, options) => {
  const schedule = typeof options === "function" ? options(identity) : Schedule.isSchedule(options) ? options : buildFromOptions(options);
  return repeatOrElse(self, schedule, effect.fail);
});
/** @internal */
export const retry = /*#__PURE__*/dual(2, (self, options) => {
  const schedule = typeof options === "function" ? options(identity) : Schedule.isSchedule(options) ? options : buildFromOptions(options);
  return retryOrElse(self, schedule, effect.fail);
});
/** @internal */
export const scheduleFrom = /*#__PURE__*/dual(3, (self, initial, schedule) => effect.flatMap(Schedule.toStepWithMetadata(schedule), step => {
  let meta = Schedule.CurrentMetadata.defaultValue();
  const selfWithMeta = effect.suspend(() => effect.provideService(self, Schedule.CurrentMetadata, meta));
  return Pull.catchDone(effect.flatMap(step(initial), meta_ => {
    meta = meta_;
    const body = constant(effect.flatMap(selfWithMeta, step));
    return effect.whileLoop({
      while: constTrue,
      body,
      step(meta_) {
        meta = meta_;
      }
    });
  }), out => effect.succeed(out));
}));
const passthroughForever = /*#__PURE__*/Schedule.passthrough(Schedule.forever);
/** @internal */
export const buildFromOptions = options => {
  let schedule = options.schedule ? Schedule.passthrough(options.schedule) : passthroughForever;
  if (options.while) {
    schedule = Schedule.while(schedule, ({
      input
    }) => {
      const applied = options.while(input);
      return core.isEffect(applied) ? applied : effect.succeed(applied);
    });
  }
  if (options.until) {
    schedule = Schedule.while(schedule, ({
      input
    }) => {
      const applied = options.until(input);
      return core.isEffect(applied) ? effect.map(applied, b => !b) : effect.succeed(!applied);
    });
  }
  if (options.times !== undefined) {
    schedule = Schedule.while(schedule, ({
      attempt
    }) => effect.succeed(attempt <= options.times));
  }
  return schedule;
};
//# sourceMappingURL=schedule.js.map