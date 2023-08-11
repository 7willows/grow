#/bin/bash

curl http://localhost:38000/grow/msg \
	-X POST \
	-H "secret-key: not to be given away" \
	-d '{"init": {"field": {}, "proc": "abc", "portNames": [], "config": {}}}' 2>/dev/null | jq
