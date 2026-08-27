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
            CREATE TABLE media_imagenes_ocr(codigo_mec_ocr VARCHAR, latitud_ocr DOUBLE, longitud_ocr DOUBLE);
            INSERT INTO media_imagenes_ocr VALUES ('0000001', -25.3, -57.6);
            CREATE TABLE media_vinculos_foto_rue(requiere_revision BOOLEAN, estado_relacion VARCHAR);
            INSERT INTO media_vinculos_foto_rue VALUES (FALSE, 'CONFIRMADO_CODIGO_COORDENADAS');
            CREATE TABLE media_pdf_documentos AS SELECT 1 AS id;
            CREATE TABLE media_pdf_paginas AS SELECT 1 AS id;
            CREATE TABLE actualizaciones(completed_at_asuncion VARCHAR);
            INSERT INTO actualizaciones VALUES ('2026-08-22T12:00:00-03:00');
            CREATE TABLE media_vinculos_escuela(estado_vinculo VARCHAR);
            INSERT INTO media_vinculos_escuela VALUES ('confirmado');
            CREATE TABLE catalogo_escuelas_piloto(
              codigo_mec VARCHAR, codigo_app VARCHAR, sitio_id VARCHAR,
              nombre_establecimiento_catalogo VARCHAR, departamento_catalogo VARCHAR,
              distrito_catalogo VARCHAR, localidad_catalogo VARCHAR, zona_catalogo VARCHAR,
              latitud_catalogo DOUBLE, longitud_catalogo DOUBLE, orden_muestra INTEGER,
              sede_compartida BOOLEAN
            );
            INSERT INTO catalogo_escuelas_piloto VALUES
              ('0000001','1','S001','Escuela Uno','Capital','Asunción','Centro','Urbana',-25.3,-57.6,1,FALSE),
              ('0000002','2','S002','Escuela Dos','Central','Capiatá','Centro','Urbana',-25.4,-57.5,2,TRUE),
              ('0000003','3','S002','Escuela Tres','Central','Capiatá','Centro','Urbana',-25.4,-57.5,3,TRUE),
              ('0000004','4','S003','Escuela Cuatro','Central','San Lorenzo','Centro','Urbana',-25.35,-57.51,4,FALSE);
            CREATE VIEW v_catalogo_piloto_medios AS
              SELECT * FROM (VALUES ('0000001', 1), ('0000002', 0)) AS t(codigo_mec, archivos_medios);
            CREATE TABLE rue_tiempos_bloque(codigo_mec VARCHAR,bloque VARCHAR,subregistros_incluidos INTEGER,aulas_incluidas INTEGER,tiempo_en_sesiones_minutos DOUBLE,sesiones_observadas INTEGER,eventos_historial INTEGER);
            INSERT INTO rue_tiempos_bloque VALUES ('0000001','1',10,4,120,1,10);
            CREATE TABLE rue_tiempos_aula(codigo_mec VARCHAR,bloque VARCHAR,planta VARCHAR,numero_aula VARCHAR,etiqueta_aula VARCHAR,tiempo_en_sesiones_minutos DOUBLE,sesiones_observadas INTEGER,eventos_historial INTEGER);
            INSERT INTO rue_tiempos_aula VALUES ('0000001','1','PB','1','Aula 1',10,1,2);
            CREATE VIEW v_escuelas_resumen AS
              SELECT codigo_mec, 0 AS carpetas_medios,
                     CASE WHEN codigo_mec = '0000001' THEN 1 ELSE 0 END AS archivos_medios,
                     CASE WHEN codigo_mec = '0000001' THEN 1 ELSE 0 END AS fotos_directas,
                     0 AS reportes_pdf, 0 AS planos_dwg, 0 AS paginas_pdf,
                     0 AS referencias_imagen_pdf,
                     CASE WHEN codigo_mec = '0000001' THEN 1 ELSE 0 END AS fotos_ocr,
                     CASE WHEN codigo_mec = '0000001' THEN 1 ELSE 0 END AS fotos_con_codigo_ocr,
                     CASE WHEN codigo_mec = '0000001' THEN 1 ELSE 0 END AS fotos_con_gps_visible,
                     CASE WHEN codigo_mec = '0000001' THEN 1 ELSE 0 END AS fotos_relacion_confirmada,
                     0 AS fotos_relacion_revision, 0 AS fotos_relacion_conflicto,
                     '' AS estados_vinculo
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
            self.assertEqual(written["metrics"]["schools"], 3)
            self.assertEqual(written["metrics"]["physicalSites"], 3)
            self.assertEqual(written["metrics"]["institutionCodes"], 4)
            self.assertEqual(written["metrics"]["ruePhysicalSites"], 2)
            self.assertEqual(written["metrics"]["rueInstitutionCodes"], 2)
            self.assertEqual(written["metrics"]["withoutRueRecord"], 1)
            self.assertEqual(written["metrics"]["closed"], 1)
            self.assertEqual(written["metrics"]["pending"], 2)
            self.assertEqual(written["metrics"]["pilotSchoolsWithMedia"], 1)
            self.assertEqual(written["metrics"]["viewableHistoricalFiles"], 1)
            self.assertEqual(written["metrics"]["photoLinksConfirmed"], 1)
            self.assertEqual(written["schools"][0]["media"]["ocrCodeDetected"], 1)
            self.assertEqual(written["schools"][0]["blocks"][0]["observedMinutes"], 120)
            self.assertEqual(written["schools"][1]["codes"], ["0000002", "0000003"])
            self.assertEqual(written["schools"][1]["rueCoverageKey"], "partial")
            self.assertFalse(written["schools"][2]["rueAvailable"])
            self.assertEqual(json.loads(audit.read_text(encoding="utf-8"))["status"], "PASS")
            self.assertEqual(EXPORT.privacy_findings(written), [])

    def test_privacy_audit_rejects_private_fields(self) -> None:
        findings = EXPORT.privacy_findings({"schools": [{"drive_url": "https://example.invalid"}]})
        self.assertEqual(findings[0]["rule"], "forbidden_key")


if __name__ == "__main__":
    unittest.main()
