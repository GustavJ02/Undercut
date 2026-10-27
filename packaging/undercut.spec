# PyInstaller spec: one executable with the engine, the server, the parameter bundle and the built client inside.
# Build with packaging/build.sh (it builds the client first). Paths are relative to the repository root.
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

root = os.path.abspath(os.path.join(SPECPATH, ".."))
datas = [
    (os.path.join(root, "params", "bundle.schema.json"), "params"),
    (os.path.join(root, "params", "bundles"), os.path.join("params", "bundles")),
    (os.path.join(root, "circuits"), "circuits"),
    (os.path.join(root, "client", "dist"), os.path.join("client", "dist")),
    (os.path.join(root, "mods", "examples"), os.path.join("mods", "examples")),
]
datas += collect_data_files("jsonschema_specifications") + collect_data_files("jsonschema")
hidden = collect_submodules("uvicorn") + collect_submodules("websockets") + ["engine", "server", "scoring"]

a = Analysis([os.path.join(SPECPATH, "entry.py")], pathex=[root], datas=datas, hiddenimports=hidden,
             excludes=["tkinter", "matplotlib", "pandas"], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name="undercut", console=True, upx=False)
