import React, { useRef, useEffect, useState } from "react";
import io from "socket.io-client";

const Room = (props) => {
  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  window.audioContext = new AudioContext();

  let rms = 0;
  let gameStopped = false;

  let audioContext = new AudioContext();
  let mediaStreamSource;

  let measureInterval;
  let processor;
  const userVideo = useRef();
  const partnerVideo = useRef();
  const [userType, setUserType] = useState("A");
  const [remoteType, setRemoteType] = useState("B");

  const peerRef = useRef();
  const socketRef = useRef();
  const otherUser = useRef();
  const userStream = useRef();
  const sendPartnerChannel = useRef();
  const [winner, setWinner] = useState();

  const [userHealth, setUserHealth] = useState(100);
  const [partnerHealth, setPartnerHealth] = useState(100);
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 2,
          echoCancellation: true,
          latency: 0,
          noiseSuppression: true,
          sampleRate: 48000,
          sampleSize: 16,
        },
        video: true,
      })
      .then((stream) => {
        userVideo.current.srcObject = stream;
        userStream.current = stream;
        setUserHealth((userHealth) => 100);
        socketRef.current = io.connect("http://localhost:8000");
        socketRef.current.emit("join room", props.match.params.roomID);

        socketRef.current.on("other user", (user) => {
          callUser(user.userId);
          otherUser.current = user.userId;
          if (user.player === "B") {
            setUserType("A");
            setRemoteType("B");
          } else {
            setUserType("B");
            setRemoteType("A");
          }
        });

        socketRef.current.on("user joined", (user) => {
          otherUser.current = user.userId;
        });

        socketRef.current.on("offer", handleOffer);

        socketRef.current.on("answer", handleAnswer);

        socketRef.current.on("ice-candidate", handleNewICECandidateMsg);
      });
  }, []);

  function callUser(userID) {
    peerRef.current = createPeer(userID);
    sendPartnerChannel.current = peerRef.current.createDataChannel(
      "sendPartnerChannel"
    );
    sendPartnerChannel.current.onmessage = handleReceiveMessage;
    userStream.current
      .getTracks()
      .forEach((track) => peerRef.current.addTrack(track, userStream.current));
  }

  function handleReceiveMessage(e) {
    const data = JSON.parse(e.data);
    if (!gameStopped) {
      if (data.partnerHealth <= 0) {
        clearInterval(measureInterval);
        measureInterval = undefined;
        setPartnerHealth((partnerHealth) => 0);

        setUserType((userType) => {
          closeGame(userType);
          return userType;
        });
      } else {
        setPartnerHealth((partnerHealth) => data.partnerHealth);
      }
    }
  }

  function createPeer(userID) {
    const peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.stunprotocol.org",
        },
        {
          urls: "turn:numb.viagenie.ca",
          credential: "muazkh",
          username: "webrtc@live.com",
        },
      ],
    });

    peer.onicecandidate = handleICECandidateEvent;
    peer.ontrack = handleTrackEvent;
    peer.onnegotiationneeded = () => handleNegotiationNeededEvent(userID);

    return peer;
  }

  function handleNegotiationNeededEvent(userID) {
    peerRef.current
      .createOffer()
      .then((offer) => {
        return peerRef.current.setLocalDescription(offer);
      })
      .then(() => {
        const payload = {
          target: userID,
          caller: socketRef.current.id,
          sdp: peerRef.current.localDescription,
        };
        socketRef.current.emit("offer", payload);
      })
      .catch((e) => console.log(e));
  }

  function handleOffer(incoming) {
    peerRef.current = createPeer();

    peerRef.current.ondatachannel = (ev) => {
      sendPartnerChannel.current = ev.channel;
      sendPartnerChannel.current.onmessage = handleReceiveMessage;
    };

    const desc = new RTCSessionDescription(incoming.sdp);
    peerRef.current
      .setRemoteDescription(desc)
      .then(() => {
        userStream.current
          .getTracks()
          .forEach((track) =>
            peerRef.current.addTrack(track, userStream.current)
          );
      })
      .then(() => {
        return peerRef.current.createAnswer();
      })
      .then((answer) => {
        return peerRef.current.setLocalDescription(answer);
      })
      .then(() => {
        const payload = {
          target: incoming.caller,
          caller: socketRef.current.id,
          sdp: peerRef.current.localDescription,
        };
        socketRef.current.emit("answer", payload);
      });
  }

  function handleAnswer(message) {
    const desc = new RTCSessionDescription(message.sdp);
    peerRef.current.setRemoteDescription(desc).catch((e) => console.log(e));
  }

  function handleICECandidateEvent(e) {
    if (e.candidate) {
      const payload = {
        target: otherUser.current,
        candidate: e.candidate,
      };
      socketRef.current.emit("ice-candidate", payload);
    }
  }

  function handleNewICECandidateMsg(incoming) {
    const candidate = new RTCIceCandidate(incoming);

    peerRef.current.addIceCandidate(candidate).catch((e) => console.log(e));
  }

  function handleTrackEvent(e) {
    partnerVideo.current.srcObject = e.streams[0];
    setPartnerHealth((partnerHealth) => 100);

    if (!gameStopped) measureAudio(new MediaStream(e.streams[0]));

    measureInterval = setInterval(() => {
      if (gameStopped) return;
      if (rms > 12) {
        setUserHealth((userHealth) => {
          if (userHealth - 15 <= 0) {
            clearInterval(measureInterval);
            measureInterval = undefined;
            sendMessage({ partnerHealth: 0 });

            setRemoteType((remoteType) => {
              closeGame(remoteType);
              return remoteType;
            });
            return 0;
          }
          sendMessage({ partnerHealth: userHealth - 15 });
          return userHealth - 15;
        });
      } else if (rms <= 12 && rms > 3) {
        setUserHealth((userHealth) => {
          if (userHealth - 5 <= 0) {
            clearInterval(measureInterval);
            measureInterval = undefined;
            sendMessage({ partnerHealth: 0 });

            setRemoteType((remoteType) => {
              closeGame(remoteType);
              return remoteType;
            });
            return 0;
          }
          sendMessage({ partnerHealth: userHealth - 5 });

          return userHealth - 5;
        });
      }
    }, 200);
  }

  function sendMessage(message) {
    if (sendPartnerChannel.current) {
      var state = sendPartnerChannel.current.readyState;

      if (state === "open") {
        sendPartnerChannel.current.send(JSON.stringify(message));
      }
    }
  }

  function closeGame(user) {
    mediaStreamSource.disconnect();
    userVideo.current.pause();
    userVideo.current.muted = true;
    partnerVideo.current.pause();
    partnerVideo.current.muted = true;
    gameStopped = true;
    setWinner(user);
    clearInterval(measureInterval);
  }

  function measureAudio(stream) {
    mediaStreamSource = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(2048, 1, 1);
    mediaStreamSource.connect(audioContext.destination);
    mediaStreamSource.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = function (e) {
      var inputData = e.inputBuffer.getChannelData(0);
      var inputDataLength = inputData.length;
      var total = 0;

      for (var i = 0; i < inputDataLength; i++) {
        total += inputData[i] * inputData[i];
      }

      rms = Math.sqrt(total / inputDataLength) * 100;
    };
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-around",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <h1>Player {userType}</h1>
          <video
            autoPlay
            ref={userVideo}
            controls
            muted
            width="640"
            height="480"
          />
          <div className="healthBar">
            <span
              style={{
                position: "absolute",
                left: "0px",
                top: "0px",
                zIndex: "1",
                width: "100%",
              }}
            >
              {userHealth} %
            </span>
            <div className="realHealth" style={{ width: `${userHealth}%` }}>
              &nbsp;
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <h1>Player {remoteType}</h1>
          <video
            autoPlay
            ref={partnerVideo}
            controls
            width="640"
            height="480"
          />

          <div className="healthBar">
            <span
              style={{
                position: "absolute",
                left: "0px",
                top: "0px",
                zIndex: "1",
                width: "100%",
              }}
            >
              {partnerHealth} %
            </span>
            <div className="realHealth" style={{ width: `${partnerHealth}%` }}>
              &nbsp;
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          visibility: winner !== undefined ? "visible" : "hidden",
          width: "100%",
        }}
      >
        <div id="results" className="search-results">
          Victory for Player {winner}
        </div>
      </div>
    </div>
  );
};

export default Room;
