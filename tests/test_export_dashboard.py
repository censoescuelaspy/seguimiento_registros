from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import duckdb


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("dashboard_export", ROOT / "tools" / "export_dashboard.py")
EXPORT = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(EXPORT)


class DashboardExportTest(unittest.TestCase):
    def create_database(self, path: Path) -> None:
        connection = duckdb.connect(str(path))
        connection.execute(
            """
            CREATE TABLE rue_instituciones AS SELECT * FROM (VALUES
              ('0000001','Escuela Uno','Capital','Asunción','Centro','Cerrado en campo','01/08/2026','02/08/2026',-25.3,-57.6,2,1,4,2,0,0,1,10,100,'2026-08-01T08:00:00-03:00','2026-08-01T12:00:00-03:00',1,240.0,20),
              ('0000002','Escuela Dos','Central','Capiatá','Centro','Pendiente','','',-25.4,-57.5,0,0,0,0,0,0,0,0,0,'','',0,NULL,0)
            ) AS t(codigo_mec,nombre_establecimiento,departamento,distrito,localidad_barrio,estado,fecha_iniciado_rue,fecha_actualizado_rue,latitud_decimal,longitud_decimal,bloques_plantas,areas_recreacion,aulas,dependencias,laboratorios,talleres,sanitarios,subregistros_total,respuestas_unicas,actividad_primera,actividad_ultima,sesiones_observadas,tiempo_en_sesiones_minutos,eventos_historial)
            """
        )
        connection.execute(
            """
            CREATE TABLE rue_subregistros AS SELECT 1 AS id;
            CREATE TABLE rue_respuestas_unicas AS SELECT 1 AS id;
            CREATE TABLE rue_eventos_tiempo AS SELECT 1 AS id;
            CREATE TABLE media_archivos AS SELECT 1 AS id, 'foto_directa' AS tipo_archivo;
            CREATE TABLE media_imagenes_directas AS SELECT 1 AS id;
            CREATE TABLE media_pdf_documentos AS SELECT 1 AS id;
            CREATE TABLE media_pdf_paginas AS SELECT 1 AS id;
            CREATE TABLE actualizaciones(completed_at_asuncion VARCHAR);
            INSERT INTO actualizaciones VALUES ('2026-08-22T12:00:00-03:00');
            CREATE TABLE media_vinculos_escuela(estado_vinculo VARCHAR);
            INSERT INTO media_vinculos_escuela VALUES ('confirmado');
            CREATE TABLE catalogo_escuelas_piloto(codigo_mec VARCHAR);
            INSERT INTO catalogo_escuelas_piloto VALUES ('0000001'), ('0000002');
            CREATE VIEW v_catalogo_piloto_medios AS
              SELECT * FROM (VALUES ('0000001', 1), ('0000002', 0)) AS t(codigo_mec, archivos_medios);
            CREATE TABLE rue_tiempos_bloque(codigo_mec VARCHAR,bloque VARCHAR,subregistros_incluidos INTEGER,aulas_incluidas INTEGER,tiempo_en_sesiones_minutos DOUBLE,sesiones_observadas INTEGER,eventos_historial INTEGER);
            INSERT INTO rue_tiempos_bloque VALUES ('0000001','1',10,4,120,1,10);
            CREATE TABLE rue_tiempos_aula(codigo_mec VARCHAR,bloque VARCHAR,planta VARCHAR,numero_aula VARCHAR,etiqueta_aula VARCHAR,tiempo_en_sesiones_minutos DOUBLE,sesiones_observadas INTEGER,eventos_historial INTEGER);
            INSERT INTO rue_tiempos_aula VALUES ('0000001','1','PB','1','Aula 1',10,1,2);
            CREATE VIEW v_escuelas_resumen AS
              SELECT codigo_mec, 0 AS carpetas_medios, 0 AS archivos_medios, 0 AS fotos_directas,
                     0 AS reportes_pdf, 0 AS planos_dwg, 0 AS paginas_pdf,
                     0 AS referencias_imagen_pdf, '' AS estados_vinculo
              FROM rue_instituciones;
            """
        )
        connection.close()

    def test_snapshot_is_sanitized_and_consistent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "test.duckdb"
            output = Path(temporary) / "dashboard.json"
            audit = Path(temporary) / "audit.json"
            self.create_database(database)
            snapshot = EXPORT.build_snapshot(database)
            EXPORT.write_outputs(snapshot, output, audit)
            written = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(written["metrics"]["schools"], 2)
            self.assertEqual(written["metrics"]["closed"], 1)
            self.assertEqual(written["metrics"]["pilotSchoolsWithMedia"], 1)
            self.assertEqual(written["metrics"]["viewableHistoricalFiles"], 1)
            self.assertEqual(written["schools"][0]["blocks"][0]["observedMinutes"], 120)
            self.assertEqual(json.loads(audit.read_text(encoding="utf-8"))["status"], "PASS")
            self.assertEqual(EXPORT.privacy_findings(written), [])

    def test_privacy_audit_rejects_private_fields(self) -> None:
        findings = EXPORT.privacy_findings({"schools": [{"drive_url": "https://example.invalid"}]})
        self.assertEqual(findings[0]["rule"], "forbidden_key")


if __name__ == "__main__":
    unittest.main()
