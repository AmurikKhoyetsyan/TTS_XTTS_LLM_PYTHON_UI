"""Project file routes: pack, unpack, save-to-path, browse, load-from-path.

These routes handle the ``.project`` archive format (a ZIP containing
``project.json`` plus embedded media files) and the ``.vproject`` format
for templates.  The ``/api/imgvid`` prefix is set on the parent router.
"""

import os
import io
import re
import json
import zipfile
import urllib.parse

from fastapi import APIRouter, UploadFile, File, HTTPException, Response
from pydantic import BaseModel

from core.log import app_log
import routers.imgvid.project_ops as _proj_ops

router = APIRouter()

# ── Directory constants ───────────────────────────────────────────────────────
_BASE_DIR            = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
_IMGVID_DIR          = os.path.join(_BASE_DIR, ".outputs", "imgvid")
PROJECTS_DIR         = os.path.join(_IMGVID_DIR, "projects")
TEMPLATES_DIR        = os.path.join(_IMGVID_DIR, "templates")
SAVED_PROJECTS_DIR   = os.path.join(_BASE_DIR, ".outputs", "saved_projects")
SAVED_TEMPLATES_DIR  = os.path.join(_BASE_DIR, ".outputs", "saved_templates")
IMAGES_DIR           = os.path.join(_IMGVID_DIR, "images")
CLIPS_DIR            = os.path.join(_IMGVID_DIR, "clips")
AUDIO_DIR            = os.path.join(_IMGVID_DIR, "audio")
THUMBS_DIR           = os.path.join(_IMGVID_DIR, "thumbs")

for _d in [PROJECTS_DIR, TEMPLATES_DIR, SAVED_PROJECTS_DIR, SAVED_TEMPLATES_DIR]:
    os.makedirs(_d, exist_ok=True)

# Inject directory paths into project_ops so it can resolve files
_proj_ops.IMAGES_DIR    = IMAGES_DIR
_proj_ops.CLIPS_DIR     = CLIPS_DIR
_proj_ops.AUDIO_DIR     = AUDIO_DIR
_proj_ops.THUMBS_DIR    = THUMBS_DIR
_proj_ops.PROJECTS_DIR  = PROJECTS_DIR
_proj_ops.TEMPLATES_DIR = TEMPLATES_DIR


# ── Request bodies ────────────────────────────────────────────────────────────

class ProjectSaveBody(BaseModel):
    """Request body for the save-to-path endpoint."""
    pid:      str
    dir:      str = ""
    filename: str = ""


class ProjectLoadBody(BaseModel):
    """Request body for the load-from-path endpoint."""
    file_path: str


class TemplateSaveBody(BaseModel):
    """Request body for the template save-to-vproject endpoint."""
    tid:      str
    dir:      str = ""
    filename: str = ""


class TemplateLoadBody(BaseModel):
    """Request body for the template load-from-vproject endpoint."""
    file_path: str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/projects/{pid}/pack")
async def pack_project(pid: str):
    """Download a project as a ``.project`` archive (ZIP with embedded media)."""
    path = os.path.join(PROJECTS_DIR, f"{pid}.json")
    if not os.path.exists(path):
        raise HTTPException(404, "Проект не найден")
    with open(path, encoding="utf-8") as f:
        project = json.load(f)
    buf = _proj_ops._make_project_buf(project)
    raw_name = project.get("name", "project")
    # ASCII fallback + RFC 5987 UTF-8 encoded filename for Cyrillic/Unicode support
    ascii_name = re.sub(r'[^\w\-]', '_', raw_name, flags=re.ASCII) or "project"
    utf8_name  = urllib.parse.quote(raw_name + ".project", safe="")
    app_log(f"Project packed as .project: {pid}", "INFO", "ImgVid")
    return Response(
        content=buf.read(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_name}.project"; '
                f"filename*=UTF-8''{utf8_name}"
            )
        },
    )


@router.post("/project/unpack")
async def unpack_project(file: UploadFile = File(...)):
    """Unpack an uploaded ``.project`` archive, restore its media files, and return the project JSON."""
    content = await file.read()
    buf = io.BytesIO(content)
    try:
        with zipfile.ZipFile(buf, 'r') as zf:
            project = _proj_ops._extract_project_zip(zf)
    except zipfile.BadZipFile:
        raise HTTPException(400, "Повреждённый .project файл")
    project = _proj_ops._finalize_project(project)
    app_log(f"Project unpacked from .project: {project.get('name', project['id'])}", "INFO", "ImgVid")
    return project


@router.post("/project/save-to-path")
async def save_project_to_path(body: ProjectSaveBody):
    """Export a project as a ``.project`` file to an arbitrary server-side directory."""
    proj_path = os.path.join(PROJECTS_DIR, f"{body.pid}.json")
    if not os.path.exists(proj_path):
        app_log(f"Project not found for save-to-path: {body.pid}", "ERROR", "ImgVid")
        raise HTTPException(404, "Проект не найден")
    try:
        with open(proj_path, encoding="utf-8") as f:
            project = json.load(f)
        target_dir = body.dir if body.dir else SAVED_PROJECTS_DIR
        if not os.path.isabs(target_dir):
            target_dir = os.path.join(_BASE_DIR, target_dir)
        os.makedirs(target_dir, exist_ok=True)
        fname = body.filename or (
            re.sub(r'[^\w\-]', '_', project.get("name", "project")) + ".project"
        )
        if not fname.lower().endswith('.project'):
            fname += '.project'
        dest = os.path.join(target_dir, fname)
        buf = _proj_ops._make_project_buf(project)
        with open(dest, 'wb') as fh:
            fh.write(buf.read())
        app_log(f"Project saved as .project: {dest}", "INFO", "ImgVid")
        return {"ok": True, "path": dest, "filename": fname}
    except HTTPException:
        raise
    except Exception as e:
        app_log(f"Error saving .project to path: {e}", "ERROR", "ImgVid")
        raise HTTPException(500, f"Ошибка сохранения проекта: {e}")


@router.get("/project/browse")
async def browse_project(path: str = ""):
    """List ``.project`` files in a server-side directory.

    Defaults to SAVED_PROJECTS_DIR when no path is specified.  Returns file
    metadata (name, path, size, mtime) sorted by mtime descending.
    """
    if path and os.path.isabs(path):
        target = path
    elif path:
        target = os.path.join(_BASE_DIR, path)
    else:
        target = SAVED_PROJECTS_DIR
    if not os.path.isdir(target):
        target = SAVED_PROJECTS_DIR
    files = []
    try:
        for fn in os.listdir(target):
            fp = os.path.join(target, fn)
            if os.path.isfile(fp) and fn.lower().endswith('.project'):
                files.append({
                    "name":  fn,
                    "path":  fp,
                    "size":  os.path.getsize(fp),
                    "mtime": os.path.getmtime(fp),
                })
    except PermissionError:
        pass
    files.sort(key=lambda x: x["mtime"], reverse=True)
    return {
        "dir":         target,
        "parent":      str(os.path.dirname(target)),
        "default_dir": SAVED_PROJECTS_DIR,
        "files":       files,
    }


@router.post("/project/load-from-path")
async def load_project_from_path(body: ProjectLoadBody):
    """Load a ``.project`` archive from a server-side path, restore media, and return the project JSON."""
    dest = body.file_path
    if not os.path.isabs(dest):
        dest = os.path.join(_BASE_DIR, dest)
    if not os.path.exists(dest):
        raise HTTPException(404, "Файл не найден")
    try:
        with open(dest, 'rb') as fh:
            content = fh.read()
        buf = io.BytesIO(content)
        with zipfile.ZipFile(buf, 'r') as zf:
            project = _proj_ops._extract_project_zip(zf)
        project = _proj_ops._finalize_project(project)
        app_log(f"Project loaded from path: {dest}", "INFO", "ImgVid")
        return project
    except zipfile.BadZipFile:
        app_log(f"Corrupted .project file: {dest}", "ERROR", "ImgVid")
        raise HTTPException(400, "Повреждённый .project файл")
    except HTTPException:
        raise
    except Exception as e:
        app_log(f"Error loading .project from path: {e}", "ERROR", "ImgVid")
        raise HTTPException(500, f"Ошибка загрузки проекта: {e}")


# ── Template .vproject routes ─────────────────────────────────────────────────

def _tmpl_path(tid: str) -> str:
    p = os.path.join(TEMPLATES_DIR, f"{tid}.json")
    if os.path.exists(p):
        return p
    return p


@router.get("/templates/{tid}/pack")
async def pack_template(tid: str):
    """Download a template as a ``.vproject`` archive (ZIP with embedded media)."""
    path = _tmpl_path(tid)
    if not os.path.exists(path):
        raise HTTPException(404, "Шаблон не найден")
    with open(path, encoding="utf-8") as f:
        project = json.load(f)
    buf = _proj_ops._make_project_buf(project)
    raw_name = project.get("name", "template")
    ascii_name = re.sub(r'[^\w\-]', '_', raw_name, flags=re.ASCII) or "template"
    utf8_name  = urllib.parse.quote(raw_name + ".vproject", safe="")
    app_log(f"Template packed as .vproject: {tid}", "INFO", "ImgVid")
    return Response(
        content=buf.read(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_name}.vproject"; '
                f"filename*=UTF-8''{utf8_name}"
            )
        },
    )


@router.post("/template/unpack")
async def unpack_template(file: UploadFile = File(...)):
    """Unpack an uploaded ``.vproject`` archive and return the template JSON."""
    content = await file.read()
    buf = io.BytesIO(content)
    try:
        with zipfile.ZipFile(buf, 'r') as zf:
            project = _proj_ops._extract_project_zip(zf)
    except zipfile.BadZipFile:
        raise HTTPException(400, "Повреждённый .vproject файл")
    project = _proj_ops._finalize_template(project)
    app_log(f"Template unpacked from .vproject: {project.get('name', project['id'])}", "INFO", "ImgVid")
    return project


@router.post("/template/save-to-vproject")
async def save_template_to_path(body: TemplateSaveBody):
    """Export a template as a ``.vproject`` file to an arbitrary server-side directory."""
    tmpl_path = _tmpl_path(body.tid)
    if not os.path.exists(tmpl_path):
        app_log(f"Template not found for save-to-vproject: {body.tid}", "ERROR", "ImgVid")
        raise HTTPException(404, "Шаблон не найден")
    try:
        with open(tmpl_path, encoding="utf-8") as f:
            project = json.load(f)
        target_dir = body.dir if body.dir else SAVED_TEMPLATES_DIR
        if not os.path.isabs(target_dir):
            target_dir = os.path.join(_BASE_DIR, target_dir)
        os.makedirs(target_dir, exist_ok=True)
        fname = body.filename or (
            re.sub(r'[^\w\-]', '_', project.get("name", "template")) + ".vproject"
        )
        if not fname.lower().endswith('.vproject'):
            fname += '.vproject'
        dest = os.path.join(target_dir, fname)
        buf = _proj_ops._make_project_buf(project)
        with open(dest, 'wb') as fh:
            fh.write(buf.read())
        app_log(f"Template saved as .vproject: {dest}", "INFO", "ImgVid")
        return {"ok": True, "path": dest, "filename": fname}
    except HTTPException:
        raise
    except Exception as e:
        app_log(f"Error saving .vproject to path: {e}", "ERROR", "ImgVid")
        raise HTTPException(500, f"Ошибка сохранения шаблона: {e}")


@router.get("/template/browse-vproject")
async def browse_vproject(path: str = ""):
    """List ``.vproject`` files in a server-side directory."""
    if path and os.path.isabs(path):
        target = path
    elif path:
        target = os.path.join(_BASE_DIR, path)
    else:
        target = SAVED_TEMPLATES_DIR
    if not os.path.isdir(target):
        target = SAVED_TEMPLATES_DIR
    files = []
    try:
        for fn in os.listdir(target):
            fp = os.path.join(target, fn)
            if os.path.isfile(fp) and fn.lower().endswith('.vproject'):
                files.append({
                    "name":  fn,
                    "path":  fp,
                    "size":  os.path.getsize(fp),
                    "mtime": os.path.getmtime(fp),
                })
    except PermissionError:
        pass
    files.sort(key=lambda x: x["mtime"], reverse=True)
    return {
        "dir":         target,
        "parent":      str(os.path.dirname(target)),
        "default_dir": SAVED_TEMPLATES_DIR,
        "files":       files,
    }


@router.post("/template/load-from-vproject")
async def load_template_from_vproject(body: TemplateLoadBody):
    """Load a ``.vproject`` archive from a server-side path and return the template JSON."""
    dest = body.file_path
    if not os.path.isabs(dest):
        dest = os.path.join(_BASE_DIR, dest)
    if not os.path.exists(dest):
        raise HTTPException(404, "Файл не найден")
    try:
        with open(dest, 'rb') as fh:
            content = fh.read()
        buf = io.BytesIO(content)
        with zipfile.ZipFile(buf, 'r') as zf:
            project = _proj_ops._extract_project_zip(zf)
        project = _proj_ops._finalize_template(project)
        app_log(f"Template loaded from path: {dest}", "INFO", "ImgVid")
        return project
    except zipfile.BadZipFile:
        app_log(f"Corrupted .vproject file: {dest}", "ERROR", "ImgVid")
        raise HTTPException(400, "Повреждённый .vproject файл")
    except HTTPException:
        raise
    except Exception as e:
        app_log(f"Error loading .vproject from path: {e}", "ERROR", "ImgVid")
        raise HTTPException(500, f"Ошибка загрузки шаблона: {e}")
