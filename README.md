# GROW

## Environment variables

- `GROW_LOG_LEVEL` - specify log level (see log levels: https://deno.land/std@0.175.0/log/levels.ts?s=LogLevels)
- `GROW_LOG_PRETTY` - if "true" then logs will be pretty

## TODO

- add timeout to calls
- count number of service crashes and don't restart after certain amount of crashes
- `File` class which would accept filePath (an url). This way we wouldn't have to move buffers between workers
- queue and ability to inject queued services
- message bus
- websocket
- logs and ctx (as `this`)
- remove npm:ts-pattern dependency
