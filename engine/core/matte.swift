import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

// The person cut out of a picture (2026-10-24, the effects that put things behind or around the speaker). One
// "in.jpg \t out.png" pair per line on stdin; out is a grey mask the size of the input, white where the person is.
let ctx = CIContext()
let req = VNGeneratePersonSegmentationRequest()
req.qualityLevel = .accurate
req.outputPixelFormat = kCVPixelFormatType_OneComponent8
while let line = readLine(strippingNewline: true) {
    let p = line.components(separatedBy: "\t")
    if p.count < 2 { continue }
    guard let img = CIImage(contentsOf: URL(fileURLWithPath: p[0])) else {
        FileHandle.standardError.write("cannot read \(p[0])\n".data(using: .utf8)!); continue
    }
    do { try VNImageRequestHandler(ciImage: img, options: [:]).perform([req]) } catch {
        FileHandle.standardError.write("matte failed \(p[0]): \(error)\n".data(using: .utf8)!); continue
    }
    guard let buf = req.results?.first?.pixelBuffer else { continue }
    var m = CIImage(cvPixelBuffer: buf)
    m = m.transformed(by: CGAffineTransform(scaleX: img.extent.width / m.extent.width, y: img.extent.height / m.extent.height))
    guard let cg = ctx.createCGImage(m, from: img.extent),
          let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: p[1]) as CFURL, UTType.png.identifier as CFString, 1, nil) else { continue }
    CGImageDestinationAddImage(d, cg, nil)
    CGImageDestinationFinalize(d)
    print(p[1])
}
