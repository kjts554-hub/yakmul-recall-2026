(function (root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  root.DrugReviewPolicy = policy;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function nextRecord(before, version, missedElements, day) {
    const stillDue = missedElements.length > 0 || (before?.status === 'review' && before.last_missed_day >= day);
    return {
      version,
      status: stillDue ? 'review' : 'remembered',
      attempts: (before?.attempts || 0) + 1,
      last_checked_day: day,
      last_missed_day: missedElements.length ? day : (stillDue ? before.last_missed_day : null),
      missed_elements: missedElements.length ? missedElements : (stillDue ? before.missed_elements : []),
    };
  }
  return {nextRecord};
});
