
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

const registerProxiedService = (endpoint) => {
    const expressServer = express()

    if (endpoint.urls) {
        for (let url in endpoint.urls) {
            const router = express.Router()
            const urlConfig = endpoint.urls[url]
            const proxyOptions = {
                changeOrigin: true,
                logLevel: "debug",
                pathRewrite: (path) => 
                    url && `${path.replace(url
                        .replace("*", ""), "")
                        .replace(/\/{2,}/ig, "/")}`
                    || url === "/" && path
                    || path,
                // TODO Review timeout
                //proxyTimeout: 5000,
                target: urlConfig.destination,
                ...urlConfig.proxyOptions
            };
            const middleware = httpProxyMiddleware.createProxyMiddleware(proxyOptions);
            
            // TODO Set this if no global config given
            if (urlConfig.cors) {
                router.use(cors())
            }
            router.use(middleware)
            // TODO call next
            // TODO Add logging
            //  - Local and destination IPs
            //  - Local and destination endpoints
            //  - Timestamp
            //  - HTTP status code
            //  - Headers
            //  - Other connection errors
            if (urlConfig.rewriteHeaders) {
                middleware.onProxyReq((proxyReq, res, req) => {
                    for (const header in urlConfig.headersRewrite) {
                        proxyReq.headers[header] = urlConfig.headersRewrite[header]
                    }
                })
            }
            if (urlConfig.keepAliveOptions?.timeout) {
                router.keepAliveTimeout = urlConfig.keepAliveOptions.timeout;
                router.headersTimeout = urlConfig.keepAliveOptions.timeout;
                middleware.keepAliveTimeout = urlConfig.keepAliveOptions.timeout;
                middleware.headersTimeout = urlConfig.keepAliveOptions.timeout;
            }
            expressServer.use(url, router)
            //expressServer.use((req, res) => res.status(404).end("Not Found"))
        }
    } else {
        const proxyOptions = {
            changeOrigin: true,
            logLevel: "debug",
            /*
            pathRewrite: (path) => endpoint.globalEndpoint && `${path.replace(endpoint.globalEndpoint.replace("*", ""), "")
                .replace(/\/{2,}/ig, "/")}`
                || endpoint.globalEndpoint === "/" && path
                || path,
            proxyTimeout: 5000,
            */
            target: endpoint.destination,
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


const internalServer = express()
internalServer.use(bodyParser.json());
internalServer.post("/__register", (req, res, next) => {
    // TODO WIP as this won't actually work!
    registerProxiedService(req.body)
})
internalServer.listen(80)
