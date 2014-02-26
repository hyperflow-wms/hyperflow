#!/bin/sh

if [ "$#" -ne 2 ]; then
  echo "remote_pingpong_test.sh: distributed and decentralized workflow execution test"
  echo "     using the HyperFlow REST API."
  echo
  echo "Usage:"
  echo "- run the 1st HyperFlow server:    node app.js    ( -> runs on port1)"
  echo "- run the 2nd HyperFlow server:    node app.js    ( -> runs on port2)"
  echo "- then run this script:            test/remote_pingpong_test.sh port1 port2"
  exit
fi

# URIs:
# {appfactory1} http://localhost:{port1}/apps 
# {appfactory2} http://localhost:{port2}/apps 
# {app1}        http://localhost:{port1}/apps/{appId1}
# {app2}        http://localhost:{port2}/apps/{appId2}

# REST-based protocol is as follows (<...> denotes the content of message body):
# 1) POST {appfactory1} <Wf_RemotePing.json>   ==> create Pinger instance, returns URI {app1}.
# 2) POST {appfactory2} <Wf_RemotePong.json>   ==> create Ponger instance, returns URI {app2}.
# 3) PUT {app1}/sigs/Ping/remotesinks <{app2}>  ==> connects signal "Ping" from app1 to app2.
# 4) PUT {app2}/sigs/Pong/remotesinks <{app1}>  ==> connects signal "Pong" from app2 to app1.
# 5) POST {app1} <signal data>   ==> sends the initial signal to Pinger to start the Ping-Pong.

appfact1="http://localhost:$1/apps"
appfact2="http://localhost:$2/apps"
echo $appfact1
echo $appfact2

# 1)
app1=`curl -v -X POST -d @workflows/Wf_RemotePing.json $appfact1 --header "Content-Type:application/json" 2>&1 | grep Location | cut -f 3 -d' '`
app1uri="http://localhost:$1"$app1

# 2)
app2=`curl -v -X POST -d @workflows/Wf_RemotePong.json $appfact2 --header "Content-Type:application/json" 2>&1 | grep Location | cut -f 3 -d' '`
app2uri="http://localhost:$2"$app2

# 3)
curl -v -X PUT -d "[{ \"uri\": \"$app2uri\" }]" $app1uri/sigs/Pong/remotesinks --header "Content-Type:application/json"

# 4)
curl -v -X PUT -d "[{ \"uri\": \"$app1uri\" }]" $app2uri/sigs/Ping/remotesinks --header "Content-Type:application/json"

# 5)
curl -X POST -d '{ "name": "Ping", "data": [0] }' $app1uri --header "Content-Type:application/json"
