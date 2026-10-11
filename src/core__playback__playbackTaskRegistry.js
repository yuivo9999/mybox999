export function createPlaybackTaskRegistry() {
  const tasks = new Map();
  return {
    register(task) { if (task?.request?.taskId) tasks.set(task.request.taskId, task); return task; },
    get(taskId) { return tasks.get(taskId) ?? null; },
    unregister(taskId) { tasks.delete(taskId); },
    stopAndRelease(taskId) {
      const task = tasks.get(taskId);
      if (!task) return false;
      try { task.stop?.(); } finally { task.release?.(); tasks.delete(taskId); }
      return true;
    },
    clear() { tasks.clear(); },
    ids() { return [...tasks.keys()]; },
  };
}
export const playbackTaskRegistry=createPlaybackTaskRegistry();
