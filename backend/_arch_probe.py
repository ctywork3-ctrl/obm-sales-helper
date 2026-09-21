import struct

PATHS = [
    r"C:\Program Files (x86)\Firebird\Firebird_2_5\bin\fbclient.dll",
    r"C:\OBMSB\fbclient.dll",
]

for path in PATHS:
    try:
        data = open(path, "rb").read(0x200)
        offset = struct.unpack_from("<I", data, 0x3C)[0]
        machine = struct.unpack_from("<H", data, offset + 4)[0]
        label = {0x14C: "32-bit", 0x8664: "64-bit"}.get(machine, hex(machine))
        print(f"  {label:7}  {path}")
    except Exception as exc:
        print(f"  ERR     {path}: {exc}")

print(f"\n  this python: {struct.calcsize('P') * 8}-bit")
