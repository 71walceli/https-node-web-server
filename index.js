
import "dotenv/config"
import { init } from 'vhttps';
import fs from "fs"
import httpProxyMiddleware from 'http-proxy-middleware'
import httpProxy from 'http-proxy'
import express from "express";
import cors from "cors"

const vhttpsServer = init();

vhttpsServer.setOptions({
    cert: fs.readFileSync(process.env.DEFAULT_SSL_CERT),
    key: fs.readFileSync(process.env.DEFAULT_SSL_KEY),
});

const registerProxiedService = (endpoint) => {
    const expressServer = express()
    let internalProxyServer = {}
    let internalProxyOptions = {}
    const proxyOptions = {
        changeOrigin: true,
        logLevel: "debug",
        pathRewrite: (path) => endpoint.globalEndpoint && `${path.replace(endpoint.globalEndpoint.replace("*", ""), "")
            .replace(/\/{2,}/ig, "/")}`
            || endpoint.globalEndpoint === "/" && path
            || path,
        onProxyRes: (proxyRes, req, res) => {
            if (endpoint?.proxyOptions?.tryPreventRedirectionLoops
                && [301,302,303,304,305,306,307].includes(proxyRes.statusCode) 
                && proxyRes?.headers?.location
            ) {
                proxyRes.url = proxyRes.headers.location
                req.url = `${req.protocol}://${req.hostname}${req.originalUrl || "/"}`;
                if (req.url === proxyRes.headers.location) {
                    proxyRes.statusCode = 200
                    delete proxyRes.headers.location;
                    internalProxyServer.web(req, res, internalProxyOptions, next)
                    console.log({
                        requestedUrl: req.url,
                        redirectedUrl: proxyRes.url,
                        message: "Redirect prevented",
                    })
                }
                else
                    console.log({
                        requestedUrl: req.url,
                        redirectedUrl: proxyRes.url,
                        message: "Redirect passed",
                    })
            }
        },
        proxyTimeout: 5000,
        target: endpoint.localEndpoint,
        ...endpoint.proxyOptions
    };
    const middleware = httpProxyMiddleware.createProxyMiddleware(proxyOptions);
    
    internalProxyOptions = {
        changeOrigin: true,
        followRedirects: true,
        logLevel: "debug",
        proxyTimeout: 5000,
        target: endpoint.localEndpoint,
        ...endpoint.proxyOptions
    };
    if (internalProxyOptions.hostRewrite)
        internalProxyOptions.hostRewrite = "http"
    if (internalProxyOptions.protocolRewrite)
        internalProxyOptions.protocolRewrite = endpoint.localEndpoint
    internalProxyServer = httpProxy.createProxyServer(internalProxyOptions)
    
    if (endpoint.cors) {
        expressServer.use(cors())
    }
    if (endpoint.globalEndpoint) {
        expressServer.use(endpoint.globalEndpoint, middleware)
        expressServer.use("*", (req, res) => res.status(404).end("Not Found"))
    } else {
        expressServer.use(middleware)
    }
    if (endpoint.rewriteHeaders) {
        middleware.onProxyReq((proxyReq, res, req) => {
            for (const header in endpoint.headersRewrite) {
                proxyReq.headers[header] = endpoint.headersRewrite[header]
            }
        })
    }
    if (endpoint?.keepAliveOptions?.timeout) {
        expressServer.keepAliveTimeout = endpoint.keepAliveOptions.timeout;
        expressServer.headersTimeout = endpoint.keepAliveOptions.timeout;
        middleware.keepAliveTimeout = endpoint.keepAliveOptions.timeout;
        middleware.headersTimeout = endpoint.keepAliveOptions.timeout;
    }
    vhttpsServer.use(endpoint.publicDomain
        ,{
            cert: fs.readFileSync(endpoint.cert ||
                `/Config/SSL/${endpoint.publicDomain}/fullchain1.pem`
            ),
            key: fs.readFileSync(endpoint.key ||
                `/Config/SSL/${endpoint.publicDomain}/privkey1.pem`
            ),
        }
        ,expressServer
    );
    // TODO log every request
}


if (process.env.REGISTERED_SERVICES_SPEC 
    && fs.existsSync(process.env.REGISTERED_SERVICES_SPEC)
) {
    JSON.parse(fs.readFileSync(process.env.REGISTERED_SERVICES_SPEC)).map(endpoint => {
        registerProxiedService(endpoint)
    })
}

vhttpsServer.use((req, res) => {
    console.log(`${req.headers.host} not registered`)
    res.statusCode = 404
    res.end('Not Found!');
});

vhttpsServer.listen(443);
 
