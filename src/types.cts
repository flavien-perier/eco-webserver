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
    proxyTimeout: number;
    proxyMaxSize: number;
    scriptTimeout: number;
    chromiumConcurrency: number;
    chromiumMaxQueue: number;
    logDir: string;
    enableIsomorphic: boolean;
    chromiumPath: string | null;
    header: { [name: string]: string };
    contentType: ContentTypeMap;
    proxy: { [urlPrefix: string]: string };
    use404File: boolean;
}
