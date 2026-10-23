import Foundation
import Vision
import CoreGraphics
import ImageIO

// Faces in pictures (2026-10-23, the clips of a long video: where each speaker sits). One image path per line on stdin;
// one "path \t x,y,w,h;..." row per image, each face normalised with the origin top-left, the biggest first.
while let line = readLine(strippingNewline: true) {
    let p = line.trimmingCharacters(in: .whitespaces)
    if p.isEmpty { continue }
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        FileHandle.standardError.write("cannot decode \(p)\n".data(using: .utf8)!); print("\(p)\t"); continue
    }
    let req = VNDetectFaceRectanglesRequest()
    do { try VNImageRequestHandler(cgImage: img, options: [:]).perform([req]) } catch {
        FileHandle.standardError.write("faces failed \(p): \(error)\n".data(using: .utf8)!); print("\(p)\t"); continue
    }
    let fs = (req.results ?? []).sorted { $0.boundingBox.width > $1.boundingBox.width }
    print("\(p)\t" + fs.map { f in
        let r = f.boundingBox
        return String(format: "%.4f,%.4f,%.4f,%.4f", r.minX, 1 - r.maxY, r.width, r.height)
    }.joined(separator: ";"))
}
