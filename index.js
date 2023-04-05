
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

const handleNotFound = (req, res) => {
    console.log({ status: 404, url: req?.url });
    res.statusCode = 404;
    res.end("Not Found!");
};

const registerProxiedService = (endpoint) => {
    const expressServer = express.Router();
  
    const createMiddleware = ({ endpointConfig, url }) => {
        
        // The `url` is only used here on order to create the pathRewriteFactory, so it's not needed
        //  here, Assigning the route for this middleware is done by the caller. 
        const createProxyOptions = (endpointConfig, url) => {
            const proxyOptions = {
                changeOrigin: true,
                logLevel: "debug",
                target: endpointConfig.destination,
                onError: proxyHandlers.handleError,
                onProxyReq: proxyHandlers.handleRequest,
                onProxyRes: proxyHandlers.handleResponse,
                ...endpointConfig.proxyOptions,
            };
            if (url) {
                proxyOptions.pathRewrite = proxyHandlers.pathRewriteFactory(url);
            }
            return proxyOptions;
        };

        let middleware;
        if (endpointConfig.destination.slice(0,4) === "http") {
            const proxyOptions = createProxyOptions(endpointConfig, url);
            const proxyMiddleware = httpProxyMiddleware.createProxyMiddleware(proxyOptions);
            const router = express.Router();
            if (endpointConfig.cors) {
                router.use(cors());
            }
            router.use((req, res, next) => proxyMiddleware(req, res, next));
            if (proxyOptions.keepAliveOptions?.timeout) {
                router.keepAliveTimeout = proxyOptions.keepAliveOptions.timeout;
                router.headersTimeout = proxyOptions.keepAliveOptions.timeout;
                proxyMiddleware.keepAliveTimeout = proxyOptions.keepAliveOptions.timeout;
                proxyMiddleware.headersTimeout = proxyOptions.keepAliveOptions.timeout;
            }
            if (endpointConfig.rewriteHeaders) {
                proxyMiddleware.onProxyReq((proxyReq, res, req) => {
                    for (const header in endpoint.headersRewrite) {
                        proxyReq.headers[header] = endpoint.headersRewrite[header];
                    }
                });
            }
            middleware = (req, res, next) => router(req, res, next);
        }
        else if (endpointConfig.destination.slice(0,7) === "file://") {
            middleware = express.static(endpointConfig.destination.slice(7))
        }
        else {
            throw new TypeError("Unrecognized middelware type to create")
        }
        return (req, res) => middleware(req, res, _ => handleNotFound(req, res))
    };

    if (endpoint.urls) {
        for (let url in endpoint.urls) {
            const middleware = createMiddleware({ url, endpointConfig: endpoint.urls[url], });
            expressServer.use(url, middleware);
        }
    } else {
        const middleware = createMiddleware({ endpointConfig: endpoint, });
        expressServer.use(middleware);
    }
    expressServer.use(handleNotFound);
    vhttpsServer.use(
        endpoint.publicDomain,
        {
            cert: fs.readFileSync(
                endpoint.cert || `/Config/SSL/${endpoint.publicDomain}/fullchain.pem`
            ),
            key: fs.readFileSync(
                endpoint.key || `/Config/SSL/${endpoint.publicDomain}/privkey.pem`
            ),
        },
        expressServer,
        handleNotFound,
    );
    // TODO log every request
};


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
