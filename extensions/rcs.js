function readArchiveFile(filename) {
	var file = new BinaryFile(filename, BinaryFile.ReadOnly);
	var data = new DataView(file.readAll());
	file.close();

	var result = new Map();
	var addr = 0;
	while (true) {
		var sz = data.getInt32(addr + 0x1C, true);
		if (!(sz & 0x80000000))
			break;
		var st = data.getInt32(addr, true);
		var fd = data.buffer.slice(st, st + (sz & 0x7FFFFFFF));
		var name = '';
		for (var i = addr + 4; i < addr + 0x1C; i++) {
			var c = data.getUint8(i);
			if (c == 0)
				break;
			name += String.fromCharCode(c);
		}
		result.set(name, fd);
		addr += 0x20;
	}
	return result;
}

var doorNames = ["North Door", "East Door", "South Door", "West Door"];
function readRoomsFile(data, tilemap) {
	var view = new DataView(data);
	if (view.getInt32(0, true) == 0x004C5246 && view.getInt16(4, true) == 4) {
		var flrcnt = view.getInt16(6, true);
		var headoff = view.getInt32(8, true);
		var datoff = view.getInt32(12, true);
		for (var i = 0; i < flrcnt; i++) {
			var flroff = view.getInt32(headoff, true) + datoff;
			var flrid = view.getInt16(flroff, true);
			var layer = new ObjectGroup("Floor " + flrid);
			tilemap.addLayer(layer);
			layer.className = "Floor";
			layer.visible = false;
			layer.setProperty("ID", flrid);
			var rmcnt = view.getInt16(flroff + 2, true);
			layer.setProperty("Width", view.getInt16(flroff + 4, true));
			layer.setProperty("Depth", view.getInt16(flroff + 6, true));
			layer.setProperty("Start Scene", view.getInt16(flroff + 8, true));
			layer.setProperty("Goal Scene", view.getInt16(flroff + 10, true));
			flroff += 0x10;
			var rmoff = flroff;
			var rmmap = new Map();
			for (var j = 0; j < rmcnt; j++) {
				var obj = new MapObject();
				obj.className = "Room";
				obj.shape = MapObject.Rectangle;
				obj.width = 50;
				obj.height = 50;
				var rmid = view.getInt16(rmoff, true);
				rmmap.set(rmid, obj);
				obj.setProperty("ID", rmid);
				obj.setProperty("Room Type", tiled.propertyValue("RoomType", view.getInt16(rmoff + 2, true)));
				obj.setProperty("Fix Scene", view.getInt16(rmoff + 4, true));
				obj.x = view.getInt16(rmoff + 8, true) * 100;
				obj.y = (29 - view.getInt16(rmoff + 10, true)) * 100;
				layer.addObject(obj);
				rmoff += 0x1C;
			}
			rmoff = flroff + 12;
			for (var j = 0; j < rmcnt; j++) {
				var obj = layer.objectAt(j);
				for (var k = 0; k < 4; k++) {
					var door = {};
					var id = view.getInt16(rmoff, true);
					if (id != 0)
						door["Destination"] = rmmap.get(id);
					door["Door Type"] = tiled.propertyValue("DoorType", view.getInt8(rmoff + 2));
					id = view.getInt8(rmoff + 3);
					if (id != 0)
						door["Check Event Room"] = rmmap.get(id);
					obj.setProperty(doorNames[k], tiled.propertyValue("Door", door));
					rmoff += 4;
				}
				rmoff += 12;
			}
			headoff += 4;
		}
	}
}

function writeArchiveFile(filename, files) {
	var file = new BinaryFile(filename, BinaryFile.WriteOnly);
	var headoff = 0;
	var datoff = (files.size + 1) * 0x20;
	for (var [k, v] of files.entries()) {
		file.seek(headoff + 0x1C);
		var data = new Int32Array(1);
		data[0] = v.byteLength | 0x80000000;
		file.write(data.buffer);
		file.seek(headoff);
		data[0] = datoff;
		file.write(data.buffer);
		file.seek(headoff + 4);
		data = new Uint8Array(0x18);
		for (var i = 0; i < Math.min(k.length, 0x18); ++i) {
			data[i] = k.charCodeAt(i);
		}
		file.write(data.buffer);
		file.seek(datoff);
		file.write(v);
		headoff += 0x20;
		datoff += v.byteLength;
	}
	file.commit();
}

function writeRoomsFile(tilemap) {
	var floors = tilemap.layers.filter((l) => l.className == "Floor");
	var roomcnt = floors.reduce((prev, cur) => prev + cur.objects.filter((r) => r.className == "Room").length, 0);
	var data = new ArrayBuffer(0x10 + floors.length * 0x14 + roomcnt * 0x1C);
	var view = new DataView(data);
	view.setInt32(0, 0x004C5246, true);
	view.setInt16(4, 4, true);
	view.setInt16(6, floors.length, true);
	var headoff = 0x10;
	view.setInt32(8, headoff, true);
	var datoff = headoff + floors.length * 4;
	var datbase = datoff;
	view.setInt32(12, datoff, true);
	for (var flr of floors) {
		view.setInt32(headoff, datoff - datbase, true);
		view.setInt16(datoff, flr.property("ID") ?? 0, true);
		var rooms = flr.objects.filter((r) => r.className == "Room");
		view.setInt16(datoff + 2, rooms.length, true);
		view.setInt16(datoff + 4, flr.property("Width") ?? 0, true);
		view.setInt16(datoff + 6, flr.property("Depth") ?? 0, true);
		view.setInt16(datoff + 8, flr.property("Start Scene") ?? 0, true);
		view.setInt16(datoff + 10, flr.property("Goal Scene") ?? 0, true);
		datoff += 0x10;
		for (var rm of rooms) {
			view.setInt16(datoff, rm.property("ID") ?? 0, true);
			var prop = rm.property("Room Type");
			if (prop != null)
				view.setInt16(datoff + 2, prop.value, true);
			view.setInt16(datoff + 4, rm.property("Fix Scene") ?? 0, true);
			view.setInt16(datoff + 8, rm.x / 100, true);
			view.setInt16(datoff + 10, 29 - (rm.y / 100), true);
			datoff += 12;
			for (var i = 0; i < 4; i++) {
				var door = rm.property(doorNames[i]);
				if (door != null) {
					var dst = door.value.Destination;
					if (dst != null) {
						var dst_room;
						for (var rm2 of rooms) {
							if (rm2.property("ID") == dst) {
								dst_room = rm2;
								break;
							}
						}
						view.setInt16(datoff, dst_room?.property("ID") ?? 0, true);
					} else {
						view.setInt16(datoff, 0, true);
					}
					view.setInt8(datoff + 2, door.value["Door Type"].value ?? 0);
					dst = door.value["Check Event Room"];
					if (dst != null) {
						var dst_room;
						for (var rm2 of rooms) {
							if (rm2.property("ID") == dst) {
								dst_room = rm2;
								break;
							}
						}
						view.setInt8(datoff + 3, dst_room?.property("ID") ?? 0);
					} else {
						view.setInt8(datoff + 3, 0);
					}
				}
				datoff += 4;
			}
		}
		headoff += 4;
	}
	return data;
}

var rcsMapFormat = {
	name: "ReCoM Story",
	extension: "rcs",

	//Function for reading from a rcs file
	read: function(fileName) {
		var file_path = FileInfo.path(FileInfo.fromNativeSeparators(fileName));
		var txtfile = new TextFile(fileName, TextFile.ReadOnly);
		var stginf = JSON.parse(txtfile.readAll());
		txtfile.close();

		var tilemap = new TileMap();
		tilemap.setTileSize(100, 100);
		tilemap.setSize(30, 30);

		var arc = readArchiveFile(FileInfo.joinPaths(file_path, "../SY0001.BIN"));

		readRoomsFile(arc.get(stginf.Layout), tilemap);

		return tilemap;
	},


	write: function(map, fileName) {
		var file_path = FileInfo.path(FileInfo.fromNativeSeparators(fileName));
		var txtfile = new TextFile(fileName, TextFile.ReadOnly);
		var stginf = JSON.parse(txtfile.readAll());
		txtfile.close();

		var arc = readArchiveFile(FileInfo.joinPaths(file_path, "../SY0001.BIN"));

		arc.set(stginf.Layout, writeRoomsFile(map));

		writeArchiveFile(FileInfo.joinPaths(file_path, "../SY0001.BIN"), arc);
	}

}

tiled.registerMapFormat("rcs", rcsMapFormat);
