"use strict";

/**
 * Map associating a file extension with its content-type.
 */
export interface ContentTypeMap {
    [extension: string]: string;
}

/**
 * Configuration of the eco-webserver application.
 */
export interface Configuration {
    port: string | number;
    cacheCycle: string | number;
    distDir: string;
    cacheDir: string;
    cacheMaxEntries: number;
    cacheMaxSize: number;
    cacheValidationInterval: number;
    diskCacheMaxSize: number;
    diskCacheCleanupInterval: number;
    diskWriteConcurrency: number;
    diskWriteMaxQueue: number;
    proxyTimeout: number;
    proxyMaxSize: number;
    scriptTimeout: number;
    scriptLoadConcurrency: number;
    processingConcurrency: number;
    processingMaxQueue: number;
    compressionPoolSize: number;
    compressionMaxQueue: number;
    cpuPoolSize: number;
    cpuMaxQueue: number;
    cpuWorkerThreshold: number;
    chromiumConcurrency: number;
    chromiumMaxQueue: number;
    chromiumRenderTimeout: number;
    chromiumWaitUntil: string;
    jsdomConcurrency: number;
    jsdomMaxQueue: number;
    jsdomRenderTimeout: number;
    rawCacheMaxEntries: number;
    rawCacheMaxSize: number;
    ssrCacheTtl: number;
    logDir: string;
    accessLog: boolean;
    enableIsomorphic: boolean;
    chromiumPath: string | null;
    header: { [name: string]: string };
    contentType: ContentTypeMap;
    proxy: { [urlPrefix: string]: string };
    use404File: boolean;
}
