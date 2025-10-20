/**
 * 管理员权限缓存模块
 * 减少数据库查询，提升性能
 *
 * TTL: 5分钟
 * 缓存失效：添加/删除管理员时自动清除
 */

interface AdminCacheEntry {
  isAdmin: boolean;
  timestamp: number;
}

class AdminCache {
  private cache: Map<string, AdminCacheEntry>;
  private readonly TTL: number = 5 * 60 * 1000; // 5分钟

  constructor() {
    this.cache = new Map();
  }

  /**
   * 获取缓存的管理员状态
   * @param userId 用户ID
   * @returns true/false 如果缓存有效，null 如果缓存过期
   */
  get(userId: string): boolean | null {
    const entry = this.cache.get(userId);

    if (!entry) {
      return null; // 无缓存
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > this.TTL) {
      // 缓存过期，删除并返回null
      this.cache.delete(userId);
      return null;
    }

    return entry.isAdmin;
  }

  /**
   * 设置缓存
   * @param userId 用户ID
   * @param isAdmin 是否是管理员
   */
  set(userId: string, isAdmin: boolean): void {
    this.cache.set(userId, {
      isAdmin,
      timestamp: Date.now(),
    });
  }

  /**
   * 清除特定用户的缓存
   * @param userId 用户ID
   */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /**
   * 清除所有缓存
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    size: number;
    entries: Array<{ userId: string; isAdmin: boolean; age: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([userId, entry]) => ({
      userId,
      isAdmin: entry.isAdmin,
      age: now - entry.timestamp,
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }
}

// 单例实例
export const adminCache = new AdminCache();
