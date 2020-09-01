import React from "react";
import { v1 as uuid } from "uuid";
import { Button } from 'react-bootstrap';

const CreateRoom = (props) => {
  function create() {
    const id = uuid();
    props.history.push(`/room/${id}`);
  }

  return (
    <div>
      <p>
        Para começar o jogo, por favor clique no seguinte botão e depois copie o
        url para convidar um amigo
      </p>
      <Button variant="info" onClick={create}>Create Room</Button>
    </div>
  );
};

export default CreateRoom;
