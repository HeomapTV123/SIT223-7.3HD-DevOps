export function createMetrics() {
  const counts = new Map();
  let durationSum = 0;
  let requestCount = 0;

  function observe(method, route, status, seconds) {
    const safeMethod = ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method) ? method : 'OTHER';
    // route comes from the fixed router labels, so task IDs never become metric labels.
    const key = `method="${safeMethod}",route="${route}",status="${status}"`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    durationSum += seconds;
    requestCount += 1;
  }

  function render(stats, uptime) {
    return [
      '# HELP taskboard_http_requests_total Completed HTTP requests.',
      '# TYPE taskboard_http_requests_total counter',
      ...[...counts].map(([labels, count]) => `taskboard_http_requests_total{${labels}} ${count}`),
      '# HELP taskboard_http_request_duration_seconds HTTP response duration.',
      '# TYPE taskboard_http_request_duration_seconds summary',
      `taskboard_http_request_duration_seconds_sum ${durationSum}`,
      `taskboard_http_request_duration_seconds_count ${requestCount}`,
      '# HELP taskboard_tasks Number of tasks by status.',
      '# TYPE taskboard_tasks gauge',
      `taskboard_tasks{status="open"} ${stats.open}`,
      `taskboard_tasks{status="in_progress"} ${stats.inProgress}`,
      `taskboard_tasks{status="done"} ${stats.done}`,
      '# HELP taskboard_uptime_seconds Seconds since the application started.',
      '# TYPE taskboard_uptime_seconds gauge',
      `taskboard_uptime_seconds ${uptime}`,
      '# HELP taskboard_resident_memory_bytes Resident process memory.',
      '# TYPE taskboard_resident_memory_bytes gauge',
      `taskboard_resident_memory_bytes ${process.memoryUsage().rss}`,
      '',
    ].join('\n');
  }
  return { observe, render };
}
