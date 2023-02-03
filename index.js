
import "dotenv/config"
import { init } from 'vhttps';
import fs from "fs"
import httpProxyMiddleware from 'http-proxy-middleware'
import express from "express";
import cors from "cors"
import bodyParser from "body-parser"

const vhttpsServer = init();
vhttpsServer.setOptions({
    cert: fs.readFileSync(process.env.DEFAULT_SSL_CERT),
    key: fs.readFileSync(process.env.DEFAULT_SSL_KEY),
});

// TODO Export into othr module
const proxyHandlers = {
    handleRequest: (proxyReq, req, res) => {
        // TODO Add logging
        //  - Local and destination IPs
        //  - Public and proxied endpoints
        //  - HTTP status code
        //  - Headers
        //  - Other connection errors
        console.log({
            event: "onProxyReq",
            timestamp: new Date().toLocaleString(),
            request: {
                // TODO Reveal only req.boby first bytes
                //data: inspect(req.body),
                method: req.method,
                host: req.headers.Host,
                url: req.url,
                source: `${req.connection.remoteAddress}:${req.connection.remotePort}`,
            },
        })
    },
    handleResponse: (proxyRes, req, res) => {
        console.log({
            event: "onProxyRes",
            timestamp: new Date().toLocaleString(),
            request: {
                // TODO Print location redirects
                // TODO Print content type
                //data: inspect(res.body),
                method: req.method,
                url: req.url,
                source: `${req.connection.remoteAddress}:${req.connection.remotePort}`,
            },
            response: {
                //data: inspect(res.body),
                status: res.statusCode,
            },
        })
    },
    handleError: (error, req, res, target) => {
        console.log({
            event: "onError",
            timestamp: new Date().toLocaleString(),
            request: {
                // TODO Print location redirects
                // TODO Print content type
                //data: inspect(res.body),
                method: req.method,
                url: req.url,
                source: `${req.connection.remoteAddress}:${req.connection.remotePort}`,
            },
            error: {
                message: error.message,
                stactTrace: error.stack.split(/\n\s+at /).slice(1),
            },
        })
        res?.status?.(500)?.json({ message: "Server error" })
    },
    pathRewriteFactory: url => ( 
        (path) => url && `${path.replace(url.replace("*", ""), "").replace(/\/{2,}/ig, "/")}`
            || url === "/" && path
            || path 
    ),
}

const registerProxiedService = (endpoint) => {
    const expressServer = express.Router()

    if (endpoint.urls) {
        for (let url in endpoint.urls) {
            const router = express.Router()
            const urlConfig = endpoint.urls[url]
            const proxyOptions = {
                changeOrigin: true,
                logLevel: "debug",
                // TODO Review timeout
                //proxyTimeout: 5000,
                target: urlConfig.destination,
                pathRewrite: proxyHandlers.pathRewriteFactory(url),
                onError: proxyHandlers.handleError,
                onProxyReq: proxyHandlers.handleRequest,
                onProxyRes: proxyHandlers.handleResponse,
                ...urlConfig.proxyOptions
            };
            const middleware = httpProxyMiddleware.createProxyMiddleware(proxyOptions);
            
            // TODO Set this if no global config given
            if (urlConfig.cors) {
                router.use(cors())
            }
            router.use(middleware)
            if (urlConfig.keepAliveOptions?.timeout) {
                router.keepAliveTimeout = urlConfig.keepAliveOptions.timeout;
                router.headersTimeout = urlConfig.keepAliveOptions.timeout;
                middleware.keepAliveTimeout = urlConfig.keepAliveOptions.timeout;
                middleware.headersTimeout = urlConfig.keepAliveOptions.timeout;
            }
            expressServer.use(url, router)
        }
    } else {
        const proxyOptions = {
            changeOrigin: true,
            logLevel: "debug",
            target: endpoint.destination,
            pathRewrite: proxyHandlers.pathRewriteFactory("/"),
            onError: proxyHandlers.handleError,
            onProxyReq: proxyHandlers.handleRequest,
            onProxyRes: proxyHandlers.handleResponse,
            ...endpoint.proxyOptions
        };
        const middleware = httpProxyMiddleware.createProxyMiddleware(proxyOptions);
        expressServer.use(middleware)
        
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
    }
    expressServer.use((req, res) => res.status(404).end("Not Found"))
    vhttpsServer.use(endpoint.publicDomain
        ,{
            cert: fs.readFileSync(endpoint.cert ||
                `/Config/SSL/${endpoint.publicDomain}/fullchain.pem`
            ),
            key: fs.readFileSync(endpoint.key ||
                `/Config/SSL/${endpoint.publicDomain}/privkey.pem`
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
    proxyHandlers.handleRequest(null, req, res)
    res.statusCode = 404
    res.end('Not Found!');
});

vhttpsServer.listen(443);


const internalServer = express()
internalServer.use(bodyParser.json());
internalServer.post("/__register", (req, res, next) => {
    // TODO WIP as this won't actually work!
    registerProxiedService(req.body)
})
internalServer.listen(80)
