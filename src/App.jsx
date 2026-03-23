import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

function App() {
  const [cursos, setCursos] = useState([]);

  useEffect(() => {
    async function cargarCursos() {
      const { data, error } = await supabase
        .from("cursos")
        .select("*");

      if (error) {
        console.error(error);
      } else {
        setCursos(data);
      }
    }

    cargarCursos();
  }, []);

  return (
    <div>
      <h1>Cursos disponibles</h1>

      {cursos.map((curso) => (
        <div key={curso.id}>
          <h2>{curso.titulo}</h2>
          <p>{curso.descripcion}</p>
        </div>
      ))}
    </div>
  );
}

export default App;